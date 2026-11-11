import test from "node:test";
import assert from "node:assert/strict";
import {
  normalize_orbital_lifecycle,
  orbital_is_selectable,
  ORBITAL_DISCOVERY_STRATEGIES,
  catalog_only_strategy,
} from "../sdk/orbitals/FractoOrbitalLifecycle.js";
import {
  initial_checkpoint,
  bind_checkpoint_strategy,
  encode_checkpoint,
  decode_checkpoint,
} from "../servers/fracto-data-server/handlers/orbital_data_checkpoint.js";
import {
  lifecycle_for,
  path_lifecycle,
} from "../servers/fracto-data-server/handlers/orbital_lifecycle.js";
import { trace_known_dynamic_rays } from "../sdk/orbitals/FractoKnownDynamicRays.js";
import { build_orbital_trace_request } from "../sdk/orbitals/FractoOrbitalTraceRequest.js";
import { merge_orbital_ray_cache } from "../sdk/orbitals/FractoOrbitalRayCache.js";
import { SEED_SURVEY_RAY_OPTIONS } from "../sdk/orbitals/FractoDynamicRays.js";

test("validated orbitals are selectable independently of pending ratios and missing paths", () => {
  const pending = normalize_orbital_lifecycle(null);
  assert.equal(orbital_is_selectable(pending), false);
  const discovered = normalize_orbital_lifecycle({
    ...pending,
    orbital: "validated",
  });
  assert.equal(orbital_is_selectable(discovered), true);
  assert.equal(discovered.assignments, "pending");
  assert.equal(discovered.paths.status, "missing");
  assert.equal(
    normalize_orbital_lifecycle({ ...discovered, assignments: "verified" })
      .paths.status,
    "missing",
  );
  for (const status of ["failed", "cancelled", "tracing"])
    assert.equal(
      orbital_is_selectable({
        ...discovered,
        paths: { ...discovered.paths, status },
      }),
      true,
    );
});

test("legacy rows preserve established evidence without inferring cached paths from rays_found", () => {
  assert.equal(
    lifecycle_for({ ray_status: "rays_found" }).assignments,
    "verified",
  );
  assert.equal(
    lifecycle_for({ ray_status: "rays_found" }).paths.status,
    "unknown",
  );
  assert.equal(
    lifecycle_for({ ray_status: "attracting" }).assignments,
    "not_applicable",
  );
  assert.equal(
    lifecycle_for({ ray_status: "unresolved" }).orbital,
    "validated",
  );
});

test("invalid combinations cannot promote unvalidated orbitals or empty geometry to cached", () => {
  const pending = normalize_orbital_lifecycle(null);
  assert.throws(
    () => normalize_orbital_lifecycle({ ...pending, assignments: "verified" }),
    /invalid_orbital_lifecycle/,
  );
  assert.throws(
    () =>
      normalize_orbital_lifecycle({
        ...pending,
        orbital: "validated",
        assignments: "verified",
        paths: { ...pending.paths, status: "cached" },
      }),
    /invalid_orbital_lifecycle/,
  );
  assert.throws(
    () => normalize_orbital_lifecycle({ ...pending, version: "unknown" }),
    /invalid_orbital_lifecycle/,
  );
});

test("path evidence is bound to precise targets and quality without controlling selectability", async () => {
  const orbital = {
    orbital_id: "42",
    focal_point: { re: "0", im: "0" },
    period: 1,
    ray_status: "rays_found",
    points: [
      {
        point_index: 0,
        point: { re: "1", im: "0" },
        landing_ratios: [{ numerator: "0", denominator: "1" }],
      },
    ],
  };
  const request = build_orbital_trace_request({ x: "0", y: "0" }, orbital);
  const rays = (await trace_known_dynamic_rays(request)).rays;
  const cache = merge_orbital_ray_cache(null, request, rays);
  const state = {
    ...lifecycle_for(orbital),
    paths: path_lifecycle(cache, request, SEED_SURVEY_RAY_OPTIONS),
  };
  assert.equal(state.paths.status, "cached");
  assert.equal(state.paths.cached_rays, 1);
  assert.equal(
    lifecycle_for({ ...orbital, lifecycle_state: JSON.stringify(state) }).paths
      .status,
    "cached",
  );
  const changed = {
    ...orbital,
    lifecycle_state: state,
    points: [
      { ...orbital.points[0], point: { re: "1.00000000000000001", im: "0" } },
    ],
  };
  assert.equal(lifecycle_for(changed).paths.status, "stale");
  assert.equal(orbital_is_selectable(lifecycle_for(changed)), true);
  const stronger = { ...SEED_SURVEY_RAY_OPTIONS, precision_digits: 512 };
  assert.equal(path_lifecycle(cache, request, stronger).status, "missing");
});

test("old checkpoints bind to original settings and reject silent strategy changes", async () => {
  const old = initial_checkpoint("original");
  delete old.discovery_strategy;
  old.stage = "catalog";
  old.catalog = { family_index: 233 };
  const restored = await decode_checkpoint(await encode_checkpoint(old));
  bind_checkpoint_strategy(restored, { catalog_max_denominator: 255 });
  assert.equal(
    restored.discovery_strategy,
    ORBITAL_DISCOVERY_STRATEGIES.SURVEY_CATALOG,
  );
  assert.equal(restored.catalog.family_index, 233);
  assert.throws(
    () => bind_checkpoint_strategy(restored, { catalog_max_denominator: 0 }),
    /checkpoint_strategy_mismatch/,
  );
  assert.equal(
    bind_checkpoint_strategy(initial_checkpoint(), {}).discovery_strategy,
    ORBITAL_DISCOVERY_STRATEGIES.SURVEY,
  );
  const future = { ...old, discovery_strategy: catalog_only_strategy.id };
  assert.equal(catalog_only_strategy.path_policy, "on_selection");
  assert.throws(
    () => bind_checkpoint_strategy(future, { catalog_max_denominator: 255 }),
    /checkpoint_strategy_mismatch/,
  );
});
