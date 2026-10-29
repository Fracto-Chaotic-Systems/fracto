import test from "node:test";
import assert from "node:assert/strict";
import { MeshInventory } from "../sdk/terrain/Inventory.js";
import {
  terrain_refinements,
  request_lod_plan,
  resolve_lod_plan,
} from "../sdk/terrain/Lod.js";
import { terrain_palette_mapper } from "../sdk/terrain/Palette.js";

function fixture() {
  const inventory = new MeshInventory({ source: "lod-test" });
  for (const code of ["00", "000", "001", "002", "003"])
    inventory.upsert({
      short_code: code,
      namespace: inventory.namespace,
      compressed_bytes: 10,
      sha256: "a".repeat(64),
    });
  const parent = inventory.get("00"),
    bounds = parent.bounds;
  const tiles = [
    {
      short_code: "00",
      sha256: parent.sha256,
      bounds,
      instances: [
        { mirror_y: false, bounds },
        {
          mirror_y: true,
          bounds: { ...bounds, top: -bounds.bottom, bottom: -bounds.top },
        },
      ],
    },
  ];
  const region = {
    focal_point: { x: -1.5, y: 0 },
    scope: 1,
    aspect_ratio: 4,
    bounds: { left: -2, right: -1, top: 2, bottom: -2 },
  };
  const base = {
    namespace: inventory.namespace,
    level: 2,
    region,
    tiles,
    refinements: terrain_refinements(inventory, tiles, region),
  };
  return { inventory, base };
}
test("one ready child quartet replaces only its nearby physical parent placement", () => {
  const { base } = fixture();
  assert.equal(base.refinements.length, 2);
  const request = request_lod_plan(base, ["00/0"]);
  assert.equal(request.tiles.length, 5);
  const resolved = resolve_lod_plan(
    request,
    new Set(request.tiles.map((tile) => tile.short_code)),
  );
  assert.deepEqual(resolved.refined_groups, ["00/0"]);
  assert.equal(resolved.detail_level, 3);
  assert.equal(
    resolved.tiles.find((tile) => tile.short_code === "00").instances[0]
      .mirror_y,
    true,
  );
  assert.equal(
    resolved.tiles.filter((tile) => tile.short_code.length === 3).length,
    4,
  );
  const coarse = resolve_lod_plan(request_lod_plan(base, []), new Set(["00"]));
  assert.equal(coarse.tiles.length, 1);
  assert.equal(coarse.tiles[0].instances.length, 2);
});
test("missing or stale children prevent refinement, and failed downloads retain the parent", () => {
  const { inventory, base } = fixture();
  const request = request_lod_plan(base, ["00/0"]);
  const fallback = resolve_lod_plan(
    request,
    new Set(["00", "000", "001", "002"]),
  );
  assert.equal(fallback.tiles.length, 1);
  assert.equal(fallback.tiles[0].instances.length, 2);
  assert.deepEqual(fallback.refined_groups, []);
  inventory.upsert({
    short_code: "003",
    namespace: "b".repeat(32),
    sha256: "a".repeat(64),
    compressed_bytes: 10,
  });
  assert.equal(
    terrain_refinements(inventory, base.tiles, base.region).length,
    0,
  );
  inventory.remove("003");
  assert.equal(
    terrain_refinements(inventory, base.tiles, base.region).length,
    0,
  );
});
test("both conjugate refinements share four files and never overlap their parent", () => {
  const { base } = fixture(),
    request = request_lod_plan(base, ["00/0", "00/1"]);
  assert.equal(request.tiles.length, 5);
  const result = resolve_lod_plan(
    request,
    new Set(request.tiles.map((tile) => tile.short_code)),
  );
  assert.equal(result.tiles.length, 4);
  assert.ok(result.tiles.every((tile) => tile.instances.length === 2));
  assert.equal(
    result.tiles.some((tile) => tile.short_code === "00"),
    false,
  );
});
test("finer samples use a stable base palette without moving existing tones", () => {
  const palette = {
    escaped: { _10: 220, _100: 80 },
    inner: {},
    outer: { _20: 40 },
  };
  const mapper = terrain_palette_mapper(palette);
  const result = mapper({
    patterns: new Int32Array([0, 0, 0, -2, 3]),
    iterations: new Float64Array([10, 55, 100, 99, 30]),
  });
  assert.equal(result.escaped._55, 150);
  assert.equal(result.escaped._10, 220);
  assert.equal(result.inner._99, 35);
  assert.deepEqual(palette.escaped, { _10: 220, _100: 80 });
  assert.equal(
    mapper({
      patterns: new Int32Array([0]),
      iterations: new Float64Array([55]),
    }).escaped._55,
    150,
  );
});
