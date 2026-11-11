import test from "node:test";
import assert from "node:assert/strict";
import {
  build_denominator_catalog,
  catalog_doubling_families,
} from "../sdk/orbitals/FractoDenominatorCatalog.js";
import { trace_catalog_ray_family } from "../sdk/orbitals/FractoCatalogDynamicRays.js";
import { find_dynamic_rays } from "../sdk/orbitals/FractoDynamicRays.js";

const parameter = { x: 0, y: 0 };
const orbital = { points: [{ x: 1, y: 0 }] };
const profile = {
  tolerance: 1e-5,
  minimum_depth: 32,
  maximum_depth: 32,
  max_points: 6000,
  precision_digits: 128,
};
const catalog = build_denominator_catalog({ max_denominator: 59 });
const family = [...catalog_doubling_families(catalog)].find(
  (item) => item.key === "1/59",
);
const assessment = {
  period: family.angle_period,
  points: family.angles.map((angle) => ({
    x: Math.cos(2 * Math.PI * angle.value),
    y: Math.sin(2 * Math.PI * angle.value),
  })),
  multiplier: { log_modulus: family.angle_period * Math.log(2) },
};

test("catalog family tracing validates all 58 analytic rays without the legacy period-24 cutoff", () => {
  const result = trace_catalog_ray_family(
    parameter,
    assessment,
    family,
    profile,
  );
  assert.equal(result.status, "rays_found");
  assert.equal(result.rays.length, 58);
  assert.deepEqual(
    result.rays.map((ray) => ray.angle.key),
    family.angles.map((angle) => angle.key),
  );
  assert.deepEqual(
    result.rays.map((ray) => ray.point_index),
    Array.from({ length: 58 }, (_, index) => index),
  );
  assert.ok(
    result.rays.every(
      (ray) =>
        ray.reason === "potential_limit" &&
        Number.isFinite(ray.precision_error) &&
        ray.landing_error < 1e-6,
    ),
  );
});

test("explicit family limits, malformed cycles, cancellation, and landing mismatches never yield partial families", () => {
  const limited = trace_catalog_ray_family(parameter, assessment, family, {
    ...profile,
    max_family_rays: 24,
  });
  assert.equal(limited.status, "family_ray_limit");
  assert.equal(limited.angle_period, 58);
  assert.deepEqual(limited.rays, []);
  const malformed = structuredClone(family);
  malformed.angles[1] = malformed.angles[0];
  assert.throws(
    () => trace_catalog_ray_family(parameter, assessment, malformed, profile),
    /invalid_catalog_family/,
  );
  const cancelled = trace_catalog_ray_family(parameter, assessment, family, {
    ...profile,
    cancelled: () => true,
  });
  assert.equal(cancelled.status, "cancelled");
  assert.deepEqual(cancelled.rays, []);
  const mismatch = trace_catalog_ray_family(
    parameter,
    {
      ...assessment,
      period: 1,
      points: [{ x: 1, y: 0 }],
    },
    family,
    profile,
  );
  assert.equal(mismatch.status, "family_mismatch");
  assert.deepEqual(mismatch.rays, []);
  const insufficient = trace_catalog_ray_family(parameter, assessment, family, {
    ...profile,
    max_points: 10,
  });
  assert.equal(insufficient.status, "family_mismatch");
  assert.equal(insufficient.reason, "point_limit");
  assert.deepEqual(insufficient.rays, []);
});

test("a period-two catalog family can land at a period-one orbital", async () => {
  const result = await find_dynamic_rays(
    { x: -1, y: 0 },
    {
      points: [{ x: (1 - Math.sqrt(5)) / 2, y: 0 }],
    },
    {
      ...profile,
      catalog: build_denominator_catalog({ max_denominator: 3 }),
      max_angle_period: 1,
      minimum_depth: 96,
      maximum_depth: 128,
    },
  );
  assert.equal(result.status, "rays_found");
  assert.equal(result.period, 1);
  assert.deepEqual(
    result.rays.map((ray) => ray.angle.key),
    ["1/3", "2/3"],
  );
  assert.ok(result.rays.every((ray) => ray.point_index === 0));
});

test("catalog search uses denominator order, includes divisor families, and reports numerical limits explicitly", async () => {
  const progress = [];
  const result = await find_dynamic_rays(parameter, orbital, {
    ...profile,
    catalog,
    max_angle_period: 1,
    max_family_rays: 24,
    on_progress: (update) => progress.push(update),
  });
  assert.equal(result.status, "rays_found");
  assert.equal(result.rays[0].angle.key, "0/1");
  assert.equal(result.search.strategy, "denominator_catalog");
  assert.equal(result.search.max_denominator, 59);
  assert.equal(result.search.candidates, catalog.family_count);
  assert.equal(result.search.remaining_families, 0);
  assert.equal(result.search.exhausted, true);
  assert.equal(result.search.complete, false);
  assert.ok(
    result.unresolved.some(
      (item) =>
        item.family_key === "1/59" &&
        item.angle_period === 58 &&
        item.reason === "family_ray_limit",
    ),
  );
  assert.deepEqual(
    result.unresolved.map((item) => item.family_key),
    [...catalog_doubling_families(catalog)].slice(1).map((item) => item.key),
  );
  assert.ok(
    progress.some(
      (update) => update.stage === "catalog_families" && update.processed > 1,
    ),
  );
});

test("catalog family checkpoints resume without repeating work or changing results", async () => {
  const small = build_denominator_catalog({ max_denominator: 7 });
  const options = { ...profile, catalog: small, retain_geometry: false };
  const expected = await find_dynamic_rays(parameter, orbital, options);
  const processed = [];
  let result, state;
  do {
    result = await find_dynamic_rays(parameter, orbital, {
      ...options,
      max_work_units: 1,
      state,
      on_progress: (update) => {
        if (update.stage === "catalog_families")
          processed.push(update.processed);
      },
    });
    if (result.status === "checkpoint")
      state = JSON.parse(JSON.stringify(result.state));
  } while (result.status === "checkpoint");
  assert.deepEqual(result, expected);
  assert.deepEqual(processed, [0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
  assert.ok(result.rays.every((ray) => !Object.hasOwn(ray, "points")));
  for (const changed of [
    { catalog: build_denominator_catalog({ max_denominator: 9 }) },
    { max_family_rays: 2 },
    { precision_digits: 256 },
    { retain_geometry: true },
  ])
    await assert.rejects(
      find_dynamic_rays(parameter, orbital, { ...options, ...changed, state }),
      /ray_checkpoint_mismatch/,
    );
  await assert.rejects(
    find_dynamic_rays({ x: -1, y: 0 }, orbital, { ...options, state }),
    /ray_checkpoint_mismatch/,
  );
  await assert.rejects(
    find_dynamic_rays(parameter, orbital, {
      ...options,
      state: { ...state, family_index: 0 },
    }),
    /ray_checkpoint_mismatch/,
  );
});

test("family-count budgets, invalid catalogs, and attracting cycles retain explicit outcomes", async () => {
  const bounded = await find_dynamic_rays(parameter, orbital, {
    ...profile,
    catalog,
    max_families: 1,
  });
  assert.equal(bounded.search.budget_reached, true);
  assert.equal(bounded.search.candidates, 1);
  assert.equal(bounded.search.remaining_families, catalog.family_count - 1);
  assert.equal(bounded.search.exhausted, false);
  const attracting = await find_dynamic_rays(
    parameter,
    { points: [{ x: 0, y: 0 }] },
    { catalog },
  );
  assert.equal(attracting.status, "attracting");
  const invalid = structuredClone(catalog);
  invalid.denominators.pop();
  await assert.rejects(
    find_dynamic_rays(parameter, orbital, { catalog: invalid }),
    /coverage/,
  );
  await assert.rejects(
    find_dynamic_rays(parameter, orbital, { catalog, max_family_rays: 0 }),
    RangeError,
  );
  const cancelled = await find_dynamic_rays(parameter, orbital, {
    catalog,
    cancelled: () => true,
  });
  assert.equal(cancelled.status, "cancelled");
});

test("canceling after a completed family preserves a resumable checkpoint", async () => {
  let stop = false;
  const small = build_denominator_catalog({ max_denominator: 3 });
  const cancelled = await find_dynamic_rays(parameter, orbital, {
    ...profile,
    catalog: small,
    cancelled: () => stop,
    on_progress: (update) => {
      if (update.processed === 1 && update.stage === "catalog_families")
        stop = true;
    },
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.state.processed, 1);
  const resumed = await find_dynamic_rays(parameter, orbital, {
    ...profile,
    catalog: small,
    state: JSON.parse(JSON.stringify(cancelled.state)),
  });
  assert.equal(resumed.search.candidates, 2);
  assert.deepEqual(
    resumed.rays.map((ray) => ray.angle.key),
    ["0/1"],
  );
});

test("existing callers keep period-based search and their checkpoint format", async () => {
  const legacy = await find_dynamic_rays(parameter, orbital, {
    ...profile,
    max_angle_period: 1,
  });
  assert.equal(legacy.status, "rays_found");
  assert.equal(legacy.search.strategy, "doubling_families");
  assert.deepEqual(
    legacy.rays.map((ray) => ray.angle.key),
    ["0/1"],
  );
});
