import test from "node:test";
import { find_minibrot_rays } from "../sdk/orbitals/FractoMinibrotRays.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  RAY_CACHE_VERSION,
  merge_ray_cache,
  ray_cache_matches,
  reusable_ray_group,
  validate_ray_group,
  cached_ray_result,
} from "../sdk/orbitals/FractoMinibrotRayCache.js";
import { backup_insert_columns } from "../scripts/database_backup_columns.js";
const core = { x: -1, y: 0 };
const group = (error = 0.001, complete = true, points = 2) => ({
  status: complete ? "complete" : "incomplete",
  root: { x: -1.25, y: 0 },
  rays: ["2/5", "3/5"].map((key) => ({
    angle: {
      key,
      numerator: key[0],
      denominator: "5",
      value: Number(key[0]) / 5,
    },
    points: Array.from({ length: points }, () => ({ x: -1.25, y: 0 })),
    landed: complete,
    status: complete ? "complete" : "incomplete",
    endpoint_error: error,
  })),
});
test("cache keys preserve exact core coordinates and invalidate version/period changes", () => {
  const c = merge_ray_cache(null, core, 2, "doubling", group(), 0.002);
  assert.equal(ray_cache_matches(c, { x: "-1.000", y: "0.0" }, 2), true);
  assert.equal(
    ray_cache_matches(c, { x: "-1.00000000000000001", y: 0 }, 2),
    false,
  );
  assert.equal(ray_cache_matches({ ...c, version: "old" }, core, 2), false);
  assert.equal(ray_cache_matches(c, core, 3), false);
});
test("successful groups survive failed and less accurate concurrent writes", () => {
  let c = merge_ray_cache(null, core, 2, "doubling", group(), 0.002);
  c = merge_ray_cache(c, core, 2, "doubling", group(0.1, false, 10), 0.002);
  assert.equal(c.groups.doubling.result.status, "complete");
  c = merge_ray_cache(c, core, 2, "doubling", group(0.0001), 0.0002);
  assert.equal(c.groups.doubling.tolerance, 0.0002);
  c = merge_ray_cache(c, core, 2, "root_access", group(), 0.002);
  assert.deepEqual(Object.keys(c.groups).sort(), ["doubling", "root_access"]);
  assert.equal(reusable_ray_group(c.groups.doubling, 0.001), true);
  assert.equal(reusable_ray_group(c.groups.doubling, 0.00001), false);
  const display = cached_ray_result(c, 0.00001);
  assert.equal(display.status, "partial");
  assert.equal(display.doubling.rays[0].landed, false);
});
test("partial paths improve without replacing a longer useful result", () => {
  let c = merge_ray_cache(
    null,
    core,
    2,
    "doubling",
    group(0.1, false, 5),
    0.002,
  );
  c = merge_ray_cache(c, core, 2, "doubling", group(0.1, false, 2), 0.002);
  assert.equal(c.groups.doubling.result.rays[0].points.length, 5);
});
test("invalid group payloads are rejected", () => {
  for (const mutate of [
    (g) => (g.rays[0].points[0].x = Infinity),
    (g) => (g.rays[0].angle.denominator = "0"),
    (g) => (g.rays[0].landed = false),
  ]) {
    const g = group();
    mutate(g);
    assert.throws(() => validate_ray_group("doubling", g, 0.002));
  }
  assert.throws(() => validate_ray_group("invalid", group(), 0.002));
});
test("SDK cache hits avoid all calculation and only missing groups emit save events", () => {
  const source = readFileSync(
    new URL("../sdk/orbitals/FractoMinibrotRays.js", import.meta.url),
    "utf8",
  );
  const fn = source
    .slice(source.indexOf("export function find_minibrot_rays"))
    .replace("export function", "function");
  const emitted = [];
  const callbacks = {
    ray_cache_matches,
    reusable_ray_group,
    best_ray_group: (old) => old,
    visible_ray_group: (e) => e.result,
    find_component_root_rays: () => {
      throw Error("recomputed root");
    },
    find_doubling_rays: () => group(),
    find_satellite_wake_rays: () => group(),
    find_antenna_tip_rays: () => group(),
  };
  const find = vm.runInNewContext(fn + ";find_minibrot_rays", callbacks);
  const cache = merge_ray_cache(null, core, 2, "root_access", group(), 0.002);
  const result = find(core, 2, {
    cache,
    tolerance: 0.002,
    include_thirds: true,
    include_tip: true,
    on_group: (id) => emitted.push(id),
  });
  assert.equal(result.status, "complete");
  assert.deepEqual(emitted, ["doubling", "1/3", "2/3", "antenna_tip"]);
});
test("old backup refreshes exclude added cache columns", () => {
  const dump =
    "CREATE TABLE `free_bailiwicks` (\n `id` int,\n `core_point` text\n) ENGINE=InnoDB;";
  assert.deepEqual(
    backup_insert_columns(dump, "free_bailiwicks", [
      "id",
      "core_point",
      "ray_paths",
    ]),
    ["id", "core_point"],
  );
  assert.throws(() => backup_insert_columns(dump, "free_bailiwicks", ["id"]));
  const migration = readFileSync(
    new URL(
      "../database/migrations/003_minibrot-ray-paths.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /information_schema.COLUMNS/);
  assert.match(migration, /ADD COLUMN ray_paths JSON NULL/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE/);
  const init = readFileSync(
    new URL("../scripts/initialize_database.js", import.meta.url),
    "utf8",
  );
  assert.match(init, /GET_LOCK/);
  assert.match(init, /RELEASE_LOCK/);
});

test("a finer completed request wins even when a coarse endpoint happened to be closer", () => {
  let cache = merge_ray_cache(null, core, 2, "doubling", group(1e-9), 0.002);
  cache = merge_ray_cache(cache, core, 2, "doubling", group(1e-7), 0.0002);
  assert.equal(cache.groups.doubling.tolerance, 0.0002);
  assert.equal(reusable_ray_group(cache.groups.doubling, 0.0002), true);
});

test("real calculated groups round-trip through persistence and then skip calculation", () => {
  const core = { x: 0, y: 0 };
  let cache = null;
  const options = { tolerance: 0.002, include_thirds: true, include_tip: true };
  const computed = find_minibrot_rays(core, 1, {
    ...options,
    on_group: (id, result) => {
      cache = merge_ray_cache(cache, core, 1, id, result, options.tolerance);
    },
  });
  assert.equal(computed.status, "complete");
  assert.equal(Object.keys(cache.groups).length, 5);
  const loaded = find_minibrot_rays(core, 1, {
    ...options,
    cache,
    on_progress: () => assert.fail("cache hit recalculated"),
  });
  assert.equal(loaded.status, "complete");
  assert.deepEqual(
    loaded.rays.map((ray) => ray.angle.key),
    computed.rays.map((ray) => ray.angle.key),
  );
});
