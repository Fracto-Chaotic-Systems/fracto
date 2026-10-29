import test from "node:test";
import assert from "node:assert/strict";
import { plan_runtime_terrain } from "../sdk/terrain/RuntimePlan.js";
import { MeshInventory } from "../sdk/terrain/Inventory.js";
import { create_runtime_terrain_handler } from "../servers/fracto-tiles-server/terrain/Runtime.js";
import { terrain_palette } from "../sdk/terrain/Palette.js";
import FractoColors from "../sdk/FractoColors.js";

const query = {
  focal_point_x: -0.75,
  focal_point_y: 0,
  scope: 2.5,
  minimum_resolution: 1000,
};
function inventory(maximum_level = 7) {
  const inv = new MeshInventory({ source: "runtime-test" });
  for (let level = 2; level <= maximum_level; level++) {
    const edge = 2 ** level;
    for (let y = 0; y < edge / 2; y++)
      for (let x = 0; x < edge; x++) {
        let code = "";
        for (let bit = level - 1; bit >= 0; bit--)
          code += ((y >> bit) & 1) * 2 + ((x >> bit) & 1);
        inv.upsert({
          short_code: code,
          namespace: inv.namespace,
          compressed_bytes: 100,
          sha256: "a".repeat(64),
        });
      }
  }
  return inv;
}
test("runtime selects the coarsest sufficient cached level and reports level-seven fallback honestly", () => {
  const inv = inventory();
  const count = (level, focal, scope, aspect) =>
    inv.tiles_in_scope(level, focal, scope, aspect).length;
  for (const [scope, level, samples] of [
    [2.5, 3, 1281],
    [0.25, 6, 1025],
    [0.125, 7, 1025],
    [0.1, 7, 820],
  ]) {
    const result = plan_runtime_terrain(inv, { ...query, scope }, count);
    assert.equal(result.level, level);
    assert.equal(result.native_resolution.x, samples);
    assert.equal(result.minimum_met, scope !== 0.1);
    assert.equal(result.limiting_reason, scope === 0.1 ? "availability" : null);
    assert.equal(result.missing_count, 0);
    assert.ok(result.tiles.length <= 256);
    assert.ok(
      result.tiles.every(
        (tile) =>
          Object.keys(tile).sort().join() ===
          "bounds,instances,sha256,short_code",
      ),
    );
  }
  const rectangular = plan_runtime_terrain(
    inv,
    { ...query, scope: 0.25, aspect_ratio: 0.5 },
    count,
  );
  assert.equal(rectangular.level, 7);
  assert.equal(rectangular.native_resolution.y, 1025);
  const limited = plan_runtime_terrain(
    inv,
    { ...query, scope: 2.4, minimum_resolution: 5000 },
    count,
  );
  assert.equal(limited.minimum_met, false);
  assert.equal(limited.limiting_reason, "mesh_budget");
  assert.equal(limited.mesh_limit, 256);
  assert.ok(limited.tiles.length <= 256);
});

test("3500 overview minimum uses level-five meshes when levels through eight are ready", () => {
  const inv = inventory(8);
  const result = plan_runtime_terrain(
    inv,
    { ...query, minimum_resolution: 3500 },
    (level, focal, scope, aspect) =>
      inv.tiles_in_scope(level, focal, scope, aspect).length,
  );
  assert.equal(result.level, 5);
  assert.equal(result.native_resolution.x, 5121);
  assert.equal(result.minimum_met, true);
  assert.equal(result.limiting_reason, null);
  assert.ok(result.tiles.length > 64);
  assert.ok(result.tiles.length <= 256);
});

test("runtime mirrors canonical meshes once, falls back from incomplete coverage and leaves gaps explicit", () => {
  const inv = new MeshInventory({ source: "runtime-test" });
  for (const code of ["00", "000"])
    inv.upsert({
      short_code: code,
      namespace: inv.namespace,
      compressed_bytes: 10,
      sha256: "a".repeat(64),
    });
  const q = {
    focal_point_x: -1.5,
    focal_point_y: 0,
    scope: 1,
    aspect_ratio: 4,
    minimum_resolution: 300,
  };
  const result = plan_runtime_terrain(inv, q, (level) => (level === 3 ? 3 : 1));
  assert.equal(result.level, 2);
  assert.equal(result.minimum_met, false);
  assert.equal(result.tiles[0].instances.length, 2);
  assert.deepEqual(
    result.tiles[0].instances.map((i) => i.bounds.top),
    [2, -1],
  );
  const partial = plan_runtime_terrain(inv, q, () => 3);
  assert.equal(partial.level, 3);
  assert.equal(partial.missing_count, 2);
  const empty = plan_runtime_terrain(
    new MeshInventory({ source: "empty" }),
    query,
    () => 0,
  );
  assert.equal(empty.level, null);
  assert.equal(empty.minimum_met, false);
  assert.deepEqual(empty.tiles, []);
});

test("terrain endpoint validates requests, is read-only and sanitizes unexpected failures", () => {
  const inv = inventory(),
    count = () => 1;
  const response = () => ({
    code: 200,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.code = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  });
  const handler = create_runtime_terrain_handler(inv, count);
  for (const changes of [
    { scope: 0 },
    { minimum_resolution: 5001 },
    { minimum_resolution: 1.5 },
    { aspect_ratio: -1 },
    { focal_point_x: "invalid" },
  ]) {
    const res = response();
    handler({ query: { ...query, ...changes } }, res);
    assert.equal(res.code, 400);
  }
  const res = response();
  handler({ query }, res);
  assert.equal(res.code, 200);
  assert.equal(res.headers["Cache-Control"], "no-store");
  const failed = response();
  create_runtime_terrain_handler(
    {
      summary() {
        throw new Error("private path");
      },
    },
    count,
  )({ query }, failed);
  assert.equal(failed.code, 503);
  assert.equal(failed.body.error.includes("private"), false);
});

test("assembled palette uses shared histograms for all visible tiles and counts mirrored placements", () => {
  const entries = [10, 100].map((iteration, i) => ({
    mesh: {
      patterns: new Int32Array(65536),
      iterations: new Float64Array(65536).fill(iteration),
    },
    tile: {
      bounds: { left: i, right: i + 1, top: 1, bottom: 0 },
      instances: [{ mirror_y: false }, { mirror_y: true }],
    },
  }));
  const palette = terrain_palette(entries, {
    bounds: { left: 0, right: 2, top: 1, bottom: -1 },
  });
  const expected = FractoColors.get_greys_map(
    { length: 262144 },
    { _10: 131072, _100: 131072 },
    50,
    205,
  );
  assert.deepEqual(palette.escaped, expected);
  assert.deepEqual(palette.inner, {});
  assert.deepEqual(palette.outer, {});
});
