import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { MeshInventory } from "../sdk/terrain/Inventory.js";
import {
  mesh_heat_map,
  mesh_heat_map_view,
  MESH_HEAT_MAP_LIMITS,
} from "../sdk/terrain/HeatMap.js";
import { create_mesh_heat_map_handler } from "../servers/fracto-tiles-server/terrain/HeatMap.js";

const inventory = () => new MeshInventory({ generation: "heat-map-test" });
const add = (index, short_code, changes = {}) =>
  index.upsert({
    short_code,
    namespace: index.namespace,
    compressed_bytes: 123,
    sha256: "a".repeat(64),
    ...changes,
  });
const query = (changes = {}) => ({
  width_px: "8",
  focal_point_x: "-1.5",
  focal_point_y: "1.5",
  scope: "1",
  ...changes,
});
const response = () => ({
  code: 200,
  headers: {},
  status(code) {
    this.code = code;
    return this;
  },
  setHeader(key, value) {
    this.headers[key] = value;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("mesh heat map distinguishes empty coverage and paints only current ready meshes", () => {
  const index = inventory();
  const empty = mesh_heat_map(index, query());
  assert.deepEqual(empty.coverage, []);
  assert.equal(empty.uncovered_pixel_count, 64);
  assert.ok(
    empty.heat_map_buffer
      .flat()
      .every((point) => point[0] === 0 && point[1] === 0),
  );
  add(index, "00");
  add(index, "000");
  add(index, "001", { namespace: "b".repeat(32) });
  add(index, "002", { status: "invalid" });
  const map = mesh_heat_map(index, query());
  assert.equal(map.inventory_revision, index.revision);
  assert.equal(map.namespace, index.namespace);
  assert.equal(map.uncovered_pixel_count, 0);
  assert.equal(map.heat_map_buffer[0][0][1], 3);
  assert.equal(map.heat_map_buffer[7][0][1], 2);
  assert.equal(map.heat_map_buffer[0][7][1], 2);
  assert.deepEqual(map.coverage, [
    { level: 2, mesh_count: 1, compressed_bytes: 123, pixel_count: 48 },
    { level: 3, mesh_count: 1, compressed_bytes: 123, pixel_count: 16 },
  ]);
});

test("mirroring covers the lower half and crosses the real axis without duplicate mesh counts", () => {
  const index = inventory();
  add(index, "00");
  add(index, "02");
  const negative = mesh_heat_map(index, query({ focal_point_y: "-1.5" }));
  assert.ok(negative.heat_map_buffer.flat().every((point) => point[1] === 2));
  assert.equal(negative.coverage[0].mesh_count, 1);
  const crossing = mesh_heat_map(
    index,
    query({ focal_point_y: "0", scope: "0.5", aspect_ratio: "4" }),
  );
  assert.equal(crossing.height_px, 32);
  assert.equal(crossing.coverage[0].mesh_count, 1);
  assert.equal(crossing.uncovered_pixel_count, 0);
});

test("rectangular raster matches a pixel-center reference with finest-level precedence", () => {
  const index = inventory();
  for (const code of ["00", "02", "03", "000", "031", "20", "200", "1123"])
    add(index, code);
  const records = index
    .snapshot()
    .records.map((record) => index.get(record.short_code));
  for (const settings of [
    query({ width_px: 19, scope: 3, focal_point_y: 0, aspect_ratio: 0.5 }),
    query({
      width_px: 11,
      scope: 4,
      focal_point_x: 0,
      focal_point_y: 0,
      aspect_ratio: 1.7,
    }),
    query({ width_px: 5, scope: 0.1, focal_point_y: -1.8 }),
  ]) {
    const map = mesh_heat_map(index, settings),
      view = mesh_heat_map_view(settings);
    const increment = view.scope / view.width_px;
    for (let x = 0; x < view.width_px; x++)
      for (let y = 0; y < view.height_px; y++) {
        const real = view.left + (x + 0.5) * increment,
          imaginary = view.top - (y + 0.5) * increment;
        const expected = records.reduce((maximum, record) => {
          const b = record.bounds;
          const inside =
            real >= b.left &&
            real < b.right &&
            ((imaginary <= b.top && imaginary > b.bottom) ||
              (b.bottom >= 0 && imaginary <= -b.bottom && imaginary > -b.top));
          return inside ? Math.max(maximum, record.level) : maximum;
        }, 0);
        assert.equal(map.heat_map_buffer[x][y][1], expected, `pixel ${x},${y}`);
      }
    assert.equal(
      map.coverage.reduce(
        (sum, row) => sum + row.pixel_count,
        map.uncovered_pixel_count,
      ),
      map.width_px * map.height_px,
    );
  }
});

test("uncovered edges stay empty, subpixel meshes do not expand, and level 34 is supported", () => {
  const index = inventory();
  add(index, "00");
  const touching = mesh_heat_map(index, query({ focal_point_x: "-0.5" }));
  assert.equal(touching.uncovered_pixel_count, 64);
  const size = 2 ** (2 - 34);
  add(index, "0".repeat(34));
  const tiny = mesh_heat_map(index, query());
  assert.equal(tiny.coverage.find((row) => row.level === 34).pixel_count, 0);
  const zoomed = mesh_heat_map(
    index,
    query({
      width_px: 4,
      focal_point_x: -2 + size / 2,
      focal_point_y: 2 - size / 2,
      scope: size / 2,
    }),
  );
  assert.ok(zoomed.heat_map_buffer.flat().every((point) => point[1] === 34));
});

test("viewport validation rejects malformed and oversized requests before querying inventory", () => {
  const invalid = [
    { width_px: 0 },
    { width_px: 2.5 },
    { width_px: 2049 },
    { width_px: 1025 },
    { aspect_ratio: 0 },
    { aspect_ratio: -1 },
    { aspect_ratio: 0.001 },
    { aspect_ratio: 9999 },
    { scope: 0 },
    { scope: -1 },
    { scope: "1garbage" },
    { scope: "Infinity" },
    { scope: "" },
    { focal_point_x: null },
    { focal_point_y: ["1", "2"] },
    { focal_point_x: {} },
    { focal_point_x: 1e308, scope: 1 },
    { scope: 1e308, aspect_ratio: 1e308 },
  ];
  for (const changes of invalid) {
    const handler = create_mesh_heat_map_handler({
      tiles_in_scope() {
        assert.fail("queried invalid view");
      },
    });
    const res = response();
    handler({ query: query(changes) }, res);
    assert.equal(res.code, 400, JSON.stringify(changes));
  }
  assert.equal(mesh_heat_map_view(query({ width_px: 1 })).height_px, 1);
});

test("endpoint uses only in-memory mesh lookups and sanitizes errors", () => {
  const index = inventory();
  add(index, "00");
  const handler = create_mesh_heat_map_handler(index),
    original = fs.readFileSync;
  fs.readFileSync = () => {
    throw new Error("Filesystem access forbidden");
  };
  try {
    const res = response();
    handler({ query: query() }, res);
    assert.equal(res.code, 200);
    assert.equal(res.headers["Cache-Control"], "no-store");
    assert.deepEqual(
      Object.keys(res.body).sort(),
      [
        "coverage",
        "heat_map_buffer",
        "height_px",
        "inventory_revision",
        "namespace",
        "timings_ms",
        "uncovered_pixel_count",
        "width_px",
      ].sort(),
    );
    assert.ok(Object.values(res.body.timings_ms).every((value) => value >= 0));
  } finally {
    fs.readFileSync = original;
  }
  const broken = create_mesh_heat_map_handler({
    tiles_in_scope() {
      throw new Error("private path and configuration");
    },
  });
  const unavailable = response();
  broken({ query: query() }, unavailable);
  assert.equal(unavailable.code, 503);
  assert.deepEqual(unavailable.body, { error: "Mesh heat map unavailable" });
  const limited = response();
  create_mesh_heat_map_handler({
    tiles_in_scope() {
      throw Object.assign(new Error("too many"), { code: "MESH_QUERY_LIMIT" });
    },
  })({ query: query() }, limited);
  assert.equal(limited.code, 422);
});

test("bounded spatial queries count canonical meshes once and stop before excess results", () => {
  const index = inventory();
  add(index, "02");
  assert.equal(
    index.tiles_in_scope(2, { x: -1.5, y: 0 }, 1, 2, { limit: 1 }).length,
    1,
  );
  add(index, "03");
  assert.throws(
    () => index.tiles_in_scope(2, { x: -1, y: 0 }, 2, 2, { limit: 1 }),
    { code: "MESH_QUERY_LIMIT" },
  );
  assert.equal(MESH_HEAT_MAP_LIMITS.max_meshes, 100000);
});

test("the same viewport reflects inventory revisions and the candidate budget spans all levels", () => {
  const index = inventory(),
    handler = create_mesh_heat_map_handler(index);
  const first = response();
  handler({ query: query() }, first);
  add(index, "00");
  const second = response();
  handler({ query: query() }, second);
  assert.ok(second.body.inventory_revision > first.body.inventory_revision);
  assert.equal(second.body.uncovered_pixel_count, 0);
  add(index, "00", { status: "invalid" });
  const third = response();
  handler({ query: query() }, third);
  assert.ok(third.body.inventory_revision > second.body.inventory_revision);
  assert.equal(third.body.uncovered_pixel_count, 64);
  const limited = create_mesh_heat_map_handler({
    revision: 1,
    namespace: index.namespace,
    tiles_in_scope(level, _point, _scope, _aspect, options) {
      if (level === 2) {
        assert.equal(options.limit, 100000);
        return Array(100000).fill({ compressed_bytes: 1 });
      }
      assert.equal(options.limit, 0);
      throw Object.assign(new Error("too many"), { code: "MESH_QUERY_LIMIT" });
    },
  });
  const res = response();
  limited({ query: query() }, res);
  assert.equal(res.code, 422);
});
