import test from "node:test";
import assert from "node:assert/strict";
import {
  discover_catalog_orbitals,
  discover_catalog_orbital_family,
} from "../sdk/orbitals/FractoCatalogOrbitalDiscovery.js";
import {
  build_denominator_catalog,
  catalog_doubling_families,
} from "../sdk/orbitals/FractoDenominatorCatalog.js";
import {
  orbital_closure_error,
  same_orbital_cycle,
} from "../sdk/orbitals/FractoOrbitalIdentity.js";
import { validate_landing_families } from "../sdk/orbitals/FractoOrbitalDiscovery.js";

const parameter = { x: "0", y: "0" };
const catalog = build_denominator_catalog({ max_denominator: 7 });
const profile = {
  tolerance: 1e-5,
  minimum_depth: 32,
  maximum_depth: 256,
  max_points: 6000,
  precision_digits: 128,
  newton_iterations: 40,
};
let unit_circle;
const discover_unit_circle = () =>
  (unit_circle ||= discover_catalog_orbitals(parameter, {
    ...profile,
    catalog,
  }));

test("representative rays discover distinct primitive cycles without any survey seeds", async () => {
  const result = await discover_unit_circle();
  assert.equal(result.status, "orbitals_found");
  assert.equal(result.candidates.length, 5);
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.period).sort(),
    [1, 2, 3, 3, 4],
  );
  assert.deepEqual(result.unresolved, []);
  assert.equal(result.search.processed, catalog.family_count);
  assert.equal(result.search.exhausted, true);
  assert.equal(result.search.complete, false);
  for (const candidate of result.candidates) {
    assert.ok(
      Number(orbital_closure_error(parameter, candidate.points)) < 1e-24,
    );
    validate_landing_families(candidate.landing_ratios, candidate.period);
    for (const ratio of candidate.landing_ratios) {
      const theta =
        (2 * Math.PI * Number(ratio.numerator)) / Number(ratio.denominator);
      const point = candidate.points[ratio.point_index];
      assert.ok(
        Math.hypot(
          Number(point.re) - Math.cos(theta),
          Number(point.im) - Math.sin(theta),
        ) < 1e-12,
        "z squared landing assignments must match the independent analytic unit circle",
      );
    }
    assert.equal(candidate.rays.length, 0);
    assert.ok(
      candidate.families.every((family) => family.representative_reused),
    );
    assert.equal(candidate.discovery_method, "catalog_ray_endpoint_newton");
  }
  for (let a = 0; a < result.candidates.length; a++)
    for (let b = a + 1; b < result.candidates.length; b++)
      assert.equal(
        same_orbital_cycle(
          result.candidates[a].points,
          result.candidates[b].points,
        ),
        false,
      );
});

test("a higher-period family discovers a lower-period landing orbit and merges with existing storage", async () => {
  const small = build_denominator_catalog({ max_denominator: 3 });
  const first = await discover_catalog_orbitals(
    { x: -1, y: 0 },
    {
      ...profile,
      minimum_depth: 128,
      catalog: small,
    },
  );
  const alpha = first.candidates.find((candidate) =>
    candidate.families.some((family) => family.catalog_key === "1/3"),
  );
  assert.equal(alpha.period, 1);
  assert.deepEqual(
    alpha.landing_ratios.map((ratio) => ratio.point_index),
    [0, 0],
  );
  const second = await discover_catalog_orbitals(
    { x: -1, y: 0 },
    {
      ...profile,
      minimum_depth: 128,
      catalog: small,
      existing_orbitals: [
        {
          orbital_id: "42",
          focal_point: { re: "-1", im: "0" },
          precision_digits: alpha.precision_digits,
          points: alpha.points.map((point) => ({ point })),
        },
      ],
    },
  );
  assert.equal(second.existing_matches.length, 1);
  assert.equal(second.existing_matches[0].orbital_id, "42");
  assert.deepEqual(second.existing_matches[0].points, alpha.points);
  assert.equal(
    second.candidates.some((candidate) =>
      same_orbital_cycle(candidate.points, alpha.points),
    ),
    false,
  );
});

test("different doubling families landing on one orbital are deduplicated and their ratios combined", async () => {
  const c = { x: -1.7548776662466927, y: 0 };
  const result = await discover_catalog_orbitals(c, {
    ...profile,
    minimum_depth: 128,
    max_points: 10000,
    catalog,
  });
  const shared = result.candidates.filter(
    (candidate) => candidate.period === 3,
  );
  assert.equal(shared.length, 1);
  assert.deepEqual(
    shared[0].families.map((family) => family.catalog_key),
    ["1/7", "3/7"],
  );
  assert.equal(shared[0].landing_ratios.length, 6);
  validate_landing_families(shared[0].landing_ratios, 3);
  assert.ok(
    result.unresolved.some(
      (family) =>
        family.family_key === "0/1" && family.reason === "precision_limit",
    ),
  );
});

test("high-precision ray seeds recover period 58 after rejecting a nearby incorrect divisor-period cycle", () => {
  const family = [
    ...catalog_doubling_families(
      build_denominator_catalog({ max_denominator: 59 }),
    ),
  ].find((item) => item.key === "1/59");
  const result = discover_catalog_orbital_family(parameter, family, {
    ...profile,
    retain_geometry: true,
  });
  assert.equal(result.status, "orbital_found");
  assert.equal(result.candidate.period, 58);
  assert.equal(result.rays.length, 58);
  assert.equal(result.family.representative_reused, true);
  assert.ok(
    result.refinement_attempts.some(
      (attempt) =>
        attempt.period === 29 && attempt.reason === "landing_mismatch",
    ),
  );
  assert.ok(result.rays[0].endpoint_decimal.re.length > 32);
  validate_landing_families(result.landing_ratios, 58, {
    max_angle_period: 58,
  });
  assert.throws(
    () => validate_landing_families(result.landing_ratios, 58),
    /invalid_ray_family/,
  );
});

test("checkpointing and cancellation preserve completed discoveries without repeated families", async () => {
  let state, result;
  const completed = [];
  do {
    result = await discover_catalog_orbitals(parameter, {
      ...profile,
      catalog,
      state,
      max_work_units: 1,
      on_progress: (progress) => completed.push(progress.processed),
    });
    if (result.status === "checkpoint")
      state = JSON.parse(JSON.stringify(result.state));
  } while (result.status === "checkpoint");
  assert.deepEqual(result, await discover_unit_circle());
  assert.deepEqual(completed, [0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
  let cancel = false;
  const interrupted = await discover_catalog_orbitals(parameter, {
    ...profile,
    catalog,
    cancelled: () => cancel,
    on_progress: (progress) => {
      if (progress.processed === 1) cancel = true;
    },
  });
  assert.equal(interrupted.status, "cancelled");
  assert.equal(interrupted.state.processed, 1);
  const resumed = await discover_catalog_orbitals(parameter, {
    ...profile,
    catalog,
    state: JSON.parse(JSON.stringify(interrupted.state)),
  });
  assert.deepEqual(resumed, result);
  for (const changes of [
    { catalog: build_denominator_catalog({ max_denominator: 9 }) },
    { precision_digits: 256 },
    { existing_orbitals: [result.candidates[0]] },
  ])
    await assert.rejects(
      discover_catalog_orbitals(parameter, {
        ...profile,
        catalog,
        state,
        ...changes,
      }),
      /discovery_checkpoint_mismatch/,
    );
});

test("budgets and unsupported numerical conditions remain unresolved instead of producing guessed orbitals", async () => {
  const high = [
    ...catalog_doubling_families(
      build_denominator_catalog({ max_denominator: 59 }),
    ),
  ].find((family) => family.key === "1/59");
  for (const [changes, reason] of [
    [{ max_family_rays: 24 }, "family_ray_limit"],
    [{ max_refinement_period: 24 }, "refinement_period_limit"],
    [{ maximum_depth: 64 }, "depth_limit"],
    [{ max_points: 16 }, "point_limit"],
  ]) {
    const result = discover_catalog_orbital_family(parameter, high, {
      ...profile,
      ...changes,
    });
    assert.equal(result.status, "unresolved");
    assert.equal(result.reason, reason);
    assert.equal(result.candidate, undefined);
  }
  const limited = await discover_catalog_orbitals(parameter, {
    ...profile,
    catalog,
    max_families: 1,
  });
  assert.equal(limited.search.budget_reached, true);
  assert.equal(limited.search.remaining_families, catalog.family_count - 1);
  const disconnected = await discover_catalog_orbitals(
    { x: 2, y: 0 },
    { ...profile, catalog },
  );
  assert.equal(disconnected.status, "disconnected");
  assert.deepEqual(disconnected.candidates, []);
  await assert.rejects(
    discover_catalog_orbitals(parameter, { catalog, precision_digits: 32 }),
    /invalid_discovery_options/,
  );
  await assert.rejects(
    discover_catalog_orbitals(parameter, {
      catalog,
      existing_orbitals: [{ points: [{ re: "0.5", im: "0" }] }],
    }),
    /invalid_existing_orbital/,
  );
});
