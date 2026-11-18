import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { create_tile_handlers } from "../servers/fracto-tiles-server/handlers/tile.js";
import {
  tile_bounds,
  tile_code_for_point,
  tile_sample_indices,
  validate_tile_data,
  validate_tile_code,
} from "../sdk/FractoTileGeometry.js";
import { create_flight_tile_cache } from "../servers/fracto-ui/src/pages/games/flight/FlightTileCache.js";

const data = Array.from({ length: 256 }, (_, i) =>
  Array.from({ length: 256 }, (_, j) => [i - j, i + j]),
);
const level = { columns: [{ left: -2, tiles: [{ short_code: "000" }] }] };
function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("canonical geometry mirrors south, honors boundaries and preserves 34-bit level coordinates", () => {
  assert.deepEqual(tile_bounds("000"), {
    left: -2,
    right: -1.5,
    top: 2,
    bottom: 1.5,
  });
  assert.equal(tile_code_for_point(-1.75, 1.75), "000");
  assert.equal(tile_code_for_point(-1.75, -1.75), "000");
  assert.deepEqual(tile_sample_indices("000", -1.75, -1.75), {
    i: 128,
    j: 128,
    index: 128 * 256 + 128,
  });
  assert.deepEqual(tile_sample_indices("000", -1.5, 1.5), {
    i: 255,
    j: 255,
    index: 65535,
  });
  assert.equal(tile_code_for_point(-1.5, 1.5), "003");
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 8; col++) {
      const re = -2 + (col + 0.5) / 2,
        im = 2 - (row + 0.5) / 2;
      assert.equal(
        tile_code_for_point(re, im, 3),
        tile_code_for_point(re, im, 4).slice(0, 3),
      );
    }
  for (const [re, im] of [
    [-2, 2],
    [0, 0],
    [2 - Number.EPSILON, -2],
    [-0.5, -2],
  ]) {
    const code = tile_code_for_point(re, im, 34);
    assert.equal(code.length, 34);
    validate_tile_code(code);
    assert.ok(tile_sample_indices(code, re, im));
  }
  for (const [re, im] of [
    [2, 0],
    [-3, 0],
    [0, 3],
    [NaN, 0],
  ])
    assert.equal(tile_code_for_point(re, im), null);
  for (const code of ["00", "200", "004", "000/", "0".repeat(35)])
    assert.throws(() => validate_tile_code(code));
  assert.throws(() => tile_code_for_point(0, 0, 35));
  assert.equal(tile_sample_indices("000", 1, 1), null);
});

test("tile handlers validate bounded availability and never read unindexed files", async () => {
  let reads = 0;
  const handlers = create_tile_handlers({
    source_id: "test",
    get_level: () => level,
    get_tile: async () => {
      reads++;
      return data;
    },
  });
  const check = response();
  handlers.availability({ query: { short_codes: "000,001,000" } }, check);
  assert.deepEqual(check.body.availability, { "000": true, "001": false });
  assert.equal(reads, 0);
  const missing = response();
  await handlers.tile({ query: { short_code: "001" } }, missing);
  assert.equal(missing.statusCode, 404);
  assert.equal(reads, 0);
  const found = response();
  await handlers.tile({ query: { short_code: "000" } }, found);
  assert.equal(found.body.tile_data, data);
  assert.equal(found.body.source_id, "test");
  assert.equal(reads, 1);
  assert.equal(found.headers["Cache-Control"], "no-store");
  for (const short_codes of [
    "",
    "../000",
    Array(257).fill("000").join(","),
    ["000"],
  ]) {
    const res = response();
    handlers.availability({ query: { short_codes } }, res);
    assert.equal(res.statusCode, 400);
  }
  const invalid = response();
  await handlers.tile({ query: { short_code: "../../foo" } }, invalid);
  assert.equal(invalid.statusCode, 400);
});

test("indexed source failures and malformed numerical data return retryable 503 responses", async () => {
  for (const get_tile of [
    async () => false,
    async () => [[1, 2]],
    async () => {
      throw new Error("sensitive disk path");
    },
  ]) {
    const handlers = create_tile_handlers({
      source_id: "test",
      get_level: () => level,
      get_tile,
    });
    const res = response();
    await handlers.tile({ query: { short_code: "000" } }, res);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, {
      error: "TILE_UNAVAILABLE",
      source_id: "test",
    });
  }
  const malformed = data.map((col) => [...col]);
  malformed[0][0] = [1, Infinity];
  assert.throws(() => validate_tile_data(malformed));
});

test("real HTTP numerical tile and availability endpoints feed the browser cache", async (t) => {
  let reads = 0;
  const handlers = create_tile_handlers({
    source_id: "http-test",
    get_level: () => level,
    get_tile: async () => {
      reads++;
      return data;
    },
  });
  const app = express();
  app.get("/tile", handlers.tile);
  app.get("/tile_availability", handlers.availability);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, options) => {
    const res = await fetch(origin + path, options),
      body = await res.json();
    if (!res.ok)
      throw Object.assign(new Error(body.error), {
        status: res.status,
        code: body.error,
        source_id: body.source_id,
      });
    return body;
  };
  const cache = create_flight_tile_cache({
    load_tile: (code, options) => request(`/tile?short_code=${code}`, options),
    load_availability: (codes, options) =>
      request(`/tile_availability?short_codes=${codes.join(",")}`, options),
  });
  t.after(() => cache.destroy());
  assert.deepEqual(await cache.availability(["000", "001"]), {
    "000": true,
    "001": false,
  });
  assert.equal(await cache.load("001"), null);
  const [a, b] = await Promise.all([cache.load("000"), cache.load("000")]);
  assert.strictEqual(a, b);
  assert.equal(reads, 1);
  assert.equal(a.values[(9 * 256 + 2) * 2], -7);
});
