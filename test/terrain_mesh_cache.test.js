import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import {
  terrain_region,
  terrain_level,
  plan_terrain_tiles,
} from "../sdk/terrain/Plan.js";
import { build_terrain_tile } from "../sdk/terrain/Mesh.js";
import {
  encode_terrain_mesh,
  decode_terrain_mesh,
  cache_terrain_plan,
} from "../sdk/terrain/Cache.js";
import { create_terrain_cache_handlers } from "../servers/fracto-tiles-server/terrain/Jobs.js";
import { create_minibrot_terrain_region_handler } from "../servers/fracto-data-server/handlers/minibrot_terrain_region.js";

const record = {
  id: 55,
  display_settings: JSON.stringify({
    focal_point: { x: -0.16, y: 1.035 },
    scope: 0.024,
  }),
};
const all_codes = (entry) =>
  new Set(
    plan_terrain_tiles(entry, new Set()).missing_tiles.map(
      (tile) => tile.short_code,
    ),
  );
const source_tile = () =>
  Array.from({ length: 256 }, (_, x) =>
    Array.from({ length: 256 }, (_, y) => [1 + (x % 5), 1 + x * 256 + y]),
  );
const response = () => ({
  code: 200,
  status(code) {
    this.code = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("planner chooses coarsest minimum-1000 level and preserves exact saved region", () => {
  const region = terrain_region(record),
    level = terrain_level(region);
  const plan = plan_terrain_tiles(record, all_codes(record));
  assert.equal(level, 10);
  assert.ok(
    plan.native_resolution.x >= 1000 && plan.native_resolution.y >= 1000,
  );
  assert.ok((region.scope * 256) / 2 ** (3 - level) + 1 < 1000);
  assert.equal(plan.missing_tiles.length, 0);
  assert.ok(plan.tiles.length > 0);
  assert.ok(plan.tiles.every((tile) => tile.short_code.length === level));
  const sparse = plan_terrain_tiles(
    record,
    new Set([plan.tiles[0].short_code]),
  );
  assert.equal(sparse.tiles.length, 1);
  assert.equal(sparse.missing_tiles.length, plan.tiles.length - 1);
  assert.throws(() => terrain_region({ display_settings: "{}" }));
  assert.throws(() =>
    terrain_region({
      display_settings: { scope: 1, focal_point: { x: null, y: 0 } },
    }),
  );
  assert.throws(() => terrain_level(region, 0));
});

test("planner accounts for aspect ratio and mirrors negative-imaginary placements", () => {
  const entry = {
    id: 1,
    display_settings: {
      focal_point: { x: -0.75, y: 0 },
      scope: 0.1,
      aspect_ratio: 0.5,
    },
  };
  const plan = plan_terrain_tiles(entry, all_codes(entry));
  assert.ok(plan.native_resolution.y >= 1000);
  assert.ok(
    plan.tiles.some((tile) =>
      tile.instances.some((instance) => instance.mirror_y),
    ),
  );
  assert.ok(plan.tiles.every((tile) => tile.bounds.bottom >= 0));
  assert.ok(plan.tiles.some((tile) => tile.instances.length === 2));
});

test("tile mesh covers full tile bounds, preserves raw color data and normalizes heights", () => {
  const tile = source_tile();
  const mesh = build_terrain_tile(tile);
  assert.equal(mesh.vertex_count, 257 * 257);
  assert.equal(mesh.triangle_count, 2 * 256 * 256);
  assert.ok(mesh.indices instanceof Uint32Array);
  assert.equal(mesh.positions[0], 0);
  assert.equal(mesh.positions.at(-3), 1);
  assert.equal(mesh.positions.at(-1), 1);
  assert.ok(mesh.maximum_height > 0 && mesh.maximum_height <= 1);
  assert.equal(mesh.patterns[256 + 3], tile[3][1][0]);
  assert.equal(mesh.iterations[256 + 3], tile[3][1][1]);
  const encoded = encode_terrain_mesh(mesh, {
    short_code: "0133230033",
    namespace: "test",
  });
  const decoded = decode_terrain_mesh(encoded.compressed);
  assert.deepEqual(decoded.positions, mesh.positions);
  assert.deepEqual(decoded.indices, mesh.indices);
  assert.deepEqual(decoded.iterations, mesh.iterations);
  assert.equal(decoded.metadata.source_sha256, mesh.source_sha256);
  assert.throws(() => decode_terrain_mesh(Buffer.from("invalid")));
  tile[2][2] = null;
  assert.ok(build_terrain_tile(tile).triangle_count < mesh.triangle_count);
});

test("cache is reusable across selected entries and rebuilds corrupt files", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "fracto-terrain-test-"),
  );
  try {
    const full = plan_terrain_tiles(record, all_codes(record));
    const plan = {
      ...full,
      tiles: full.tiles.slice(0, 1),
      missing_tiles: full.tiles.slice(1),
    };
    let reads = 0;
    const options = {
      plan,
      cache_root: directory,
      source_identity: { fingerprint: "test-generation" },
      read_tile: async () => {
        reads++;
        return source_tile();
      },
    };
    const first = await cache_terrain_plan(options);
    assert.equal(first.created, 1);
    assert.equal(first.status, "partial");
    assert.equal(reads, 1);
    const next = await cache_terrain_plan({
      ...options,
      plan: { ...plan, bailiwick_id: 56 },
    });
    assert.equal(next.reused, 1);
    assert.equal(reads, 1);
    const replaced = await cache_terrain_plan({
      ...options,
      source_identity: { fingerprint: "replacement" },
    });
    assert.equal(replaced.created, 1);
    assert.equal(reads, 2);
    const manifest = JSON.parse(
      await fs.readFile(path.join(directory, first.manifest), "utf8"),
    );
    assert.equal(manifest.tiles[0].short_code, plan.tiles[0].short_code);
    assert.equal(manifest.boundary_policy, "clamp-local-v1");
    assert.ok(manifest.summary.compressed_bytes > 0);
    await fs.writeFile(path.join(directory, manifest.tiles[0].file), "corrupt");
    assert.equal((await cache_terrain_plan(options)).created, 1);
    assert.equal(reads, 3);
  } finally {
    assert.ok(
      path
        .resolve(directory)
        .startsWith(
          path.resolve(os.tmpdir()) + path.sep + "fracto-terrain-test-",
        ),
    );
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("job API verifies selected record, deduplicates active builds and reports progress", async () => {
  const workers = [];
  const handlers = create_terrain_cache_handlers({
    source_identity: { fingerprint: "test" },
    get_record: async () => record,
    get_codes: () => all_codes(record),
    create_worker: (data) => {
      const worker = new EventEmitter();
      worker.data = data;
      worker.terminate = async () => {};
      workers.push(worker);
      return worker;
    },
  });
  const first = response();
  await handlers.start({ body: { bailiwick_id: 55 } }, first);
  assert.equal(first.code, 202);
  const second = response();
  await handlers.start({ body: { bailiwick_id: 55 } }, second);
  assert.equal(second.body.job.id, first.body.job.id);
  assert.equal(workers.length, 1);
  workers[0].emit("message", {
    progress: { processed: 1, created: 1, reused: 0, failed: 0 },
  });
  const progress = response();
  handlers.status({ params: { id: first.body.job.id } }, progress);
  assert.equal(progress.body.job.processed, 1);
  workers[0].emit("message", {
    result: { status: "completed", tile_count: 1 },
  });
  await new Promise(setImmediate);
  handlers.status({ params: { id: first.body.job.id } }, progress);
  assert.equal(progress.body.job.status, "completed");
  const invalid = response();
  await handlers.start({ body: { bailiwick_id: "../bad" } }, invalid);
  assert.equal(invalid.code, 400);
});

test("data endpoint reads only the selected freeform region with a bound query", async () => {
  let query,
    disconnected = false;
  const handler = create_minibrot_terrain_region_handler({
    connect: () => ({
      promise: () => ({
        query: async (...args) => {
          query = args;
          return [[record]];
        },
      }),
    }),
    disconnect: () => {
      disconnected = true;
    },
  });
  const res = response();
  await handler({ params: { id: "55" } }, res);
  assert.deepEqual(query[1], [55]);
  assert.match(query[0], /is_node = 0 AND is_inline = 0/);
  assert.equal(res.body.result.id, 55);
  assert.deepEqual(Object.keys(res.body.result), ["id", "display_settings"]);
  assert.ok(disconnected);
});

test("terrain region handler imports and runs injected requests without database configuration", async () => {
  const source = await fs.readFile(
    new URL(
      "../servers/fracto-data-server/handlers/minibrot_terrain_region.js",
      import.meta.url,
    ),
    "utf8",
  );
  // A data URL has no neighboring mysql.js or config directory, even on configured developer hosts.
  const isolated = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
  let closed = false;
  const handler = isolated.create_minibrot_terrain_region_handler({
    connect: () => ({ promise: () => ({ query: async () => [[record]] }) }),
    disconnect: () => {
      closed = true;
    },
  });
  const res = response();
  await handler({ params: { id: "55" } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.result.id, 55);
  assert.equal(closed, true);
  const invalid = response();
  await isolated.handle_minibrot_terrain_region(
    { params: { id: "bad" } },
    invalid,
  );
  assert.equal(invalid.code, 400);
});
