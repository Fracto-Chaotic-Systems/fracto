import test from "node:test";
import assert from "node:assert/strict";
import {
  validate_representative_assignments,
  discover_validated_representative_orbital,
  landing_assignment_profile,
} from "../sdk/orbitals/FractoLandingAssignments.js";
import { discover_representative_orbital } from "../sdk/orbitals/FractoRepresentativeRaySolver.js";
import {
  build_denominator_catalog,
  catalog_doubling_families,
} from "../sdk/orbitals/FractoDenominatorCatalog.js";
import { validate_landing_families } from "../sdk/orbitals/FractoOrbitalDiscovery.js";
import { newton_big_complex } from "../sdk/orbitals/FractoNewtonBigComplex.js";
import {
  canonical_orbital,
  same_orbital_cycle,
} from "../sdk/orbitals/FractoOrbitalIdentity.js";
import { create_dynamic_ray_tracer } from "../sdk/orbitals/FractoDynamicRayTrace.js";
const families = [
  ...catalog_doubling_families(
    build_denominator_catalog({ max_denominator: 163 }),
  ),
];
const family = (key) => families.find((entry) => entry.key === key);
const unit = { x: "0", y: "0" };
let period58;
const candidate58 = () =>
  (period58 ||= discover_representative_orbital(unit, family("1/59")));

test("analytic assignments follow exact doubling, with no sibling curves or cached paths", () => {
  for (const key of ["0/1", "1/3", "1/5", "1/7"]) {
    const result = discover_validated_representative_orbital(unit, family(key));
    assert.equal(result.status, "assignments_verified", result.reason);
    assert.equal(result.landing_ratios.length, family(key).angle_period);
    validate_landing_families(result.landing_ratios, result.candidate.period, {
      max_angle_period: family(key).angle_period,
    });
    for (const ratio of result.landing_ratios) {
      const theta =
        (2 * Math.PI * Number(ratio.numerator)) / Number(ratio.denominator);
      const point = result.candidate.points[ratio.point_index];
      assert.ok(
        Math.hypot(
          Number(point.re) - Math.cos(theta),
          Number(point.im) - Math.sin(theta),
        ) < 1e-12,
      );
    }
    assert.equal(result.lifecycle_state.assignments, "verified");
    assert.equal(result.lifecycle_state.paths.status, "missing");
    assert.equal(result.lifecycle_state.paths.cached_rays, 0);
    assert.equal(result.assignment_statistics.sibling_rays_traced, 0);
    assert.equal(result.assignment_statistics.representative_traces, 1);
    assert.ok(result.assignment_statistics.retained_points <= 2);
    assert.deepEqual(result.rays, []);
    assert.ok(
      Number(result.evidence.assignment_validation.weighted_contraction) < 1,
    );
  }
});

test("multiple accesses in an angle family can share one basilica fixed point", () => {
  const result = discover_validated_representative_orbital(
    { x: -1, y: 0 },
    family("1/3"),
  );
  assert.equal(result.status, "assignments_verified", result.reason);
  assert.equal(result.candidate.period, 1);
  assert.deepEqual(
    result.landing_ratios.map((ratio) => ratio.point_index),
    [0, 0],
  );
});

test("terminal transport retains compact orbit samples and streams arc samples without storing curves", () => {
  let samples = 0;
  const tracer = create_dynamic_ray_tracer(
    { x: 0, y: 0 },
    family("1/7").angles[0],
    {
      retain_geometry: false,
      endpoint_window: 2,
      on_sample: () => samples++,
    },
  );
  const result = tracer.advance(2 ** -80, {
    verify_precision: true,
    precision_digits: 128,
    transport_levels: 3,
  });
  assert.equal(result.transport_endpoints.length, 4);
  assert.equal(result.points.length, 2);
  assert.ok(samples > 0);
  for (let i = 0; i < 3; i++) {
    const a = result.transport_endpoints[i],
      b = result.transport_endpoints[i + 1];
    const x = Number(a.re),
      y = Number(a.im);
    assert.ok(
      Math.hypot(x * x - y * y - Number(b.re), 2 * x * y - Number(b.im)) <
        1e-14,
    );
  }
});

test("different angle families can verify against the same spatial orbit", () => {
  const c = { x: -1.7548776662466927, y: 0 };
  const first = discover_validated_representative_orbital(c, family("1/7"));
  const second = discover_validated_representative_orbital(c, family("3/7"));
  assert.equal(first.status, "assignments_verified", first.reason);
  assert.equal(second.status, "assignments_verified", second.reason);
  assert.ok(
    same_orbital_cycle(first.candidate.points, second.candidate.points),
  );
  const a = new Set(first.landing_ratios.map((ratio) => ratio.numerator));
  assert.ok(second.landing_ratios.every((ratio) => !a.has(ratio.numerator)));
});

test("independent transport rejects a nearby valid period-29 orbit even with forged approach evidence", () => {
  const good = candidate58();
  const wrong = canonical_orbital(
    unit,
    newton_big_complex(unit, 80, 29, {
      seed: good.representative.endpoint_decimal,
      precision_digits: 128,
    }).point_list,
    128,
  );
  assert.equal(wrong.period, 29);
  const endpoint = good.representative.endpoint_decimal;
  const distances = wrong.points.map((p) =>
    Math.hypot(
      Number(p.re) - Number(endpoint.re),
      Number(p.im) - Number(endpoint.im),
    ),
  );
  const discovery = {
    ...good,
    candidate: wrong,
    evidence: { association: "numerically_verified" },
    representative: {
      ...good.representative,
      point_index: distances.indexOf(Math.min(...distances)),
    },
  };
  const result = validate_representative_assignments(
    unit,
    family("1/59"),
    discovery,
  );
  assert.equal(result.status, "assignments_pending");
  assert.equal(result.evidence.association, "pending");
  assert.deepEqual(result.landing_ratios, []);
  assert.equal(result.lifecycle_state.orbital, "validated");
  const correct = validate_representative_assignments(
    unit,
    family("1/59"),
    good,
  );
  assert.equal(correct.status, "assignments_verified", correct.reason);
  assert.equal(correct.landing_ratios.length, 58);
});

test("the 162-ray family verifies all assignments using only compact transport endpoints", () => {
  const result = discover_validated_representative_orbital(
    { x: "-0.5629527505984927", y: "0.47148116383941135" },
    family("1/163"),
  );
  assert.equal(result.status, "assignments_verified", result.reason);
  assert.equal(result.landing_ratios.length, 162);
  assert.equal(result.assignment_statistics.transport_checks, 163);
  assert.equal(result.assignment_statistics.sibling_rays_traced, 0);
  assert.equal(
    result.evidence.assignment_validation.transport_endpoints.length,
    163,
  );
  validate_landing_families(result.landing_ratios, result.candidate.period, {
    max_angle_period: 162,
  });
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 200000);
});

test("wrong anchors, budgets and cancellation leave assignments pending; full fallback is opt-in", () => {
  const f = family("1/7"),
    candidate = discover_representative_orbital(unit, f);
  const wrong = {
    ...candidate,
    representative: {
      ...candidate.representative,
      point_index:
        (candidate.representative.point_index + 1) % candidate.candidate.period,
    },
  };
  assert.equal(
    validate_representative_assignments(unit, f, wrong).status,
    "assignments_pending",
  );
  const pending = validate_representative_assignments(unit, f, candidate, {
    maximum_radius: 1e-20,
  });
  assert.equal(pending.status, "assignments_pending");
  assert.equal(pending.assignment_statistics.full_family_rays_traced, 0);
  const fallback = validate_representative_assignments(unit, f, candidate, {
    maximum_radius: 1e-20,
    full_fallback: true,
  });
  assert.equal(fallback.status, "assignments_verified", fallback.reason);
  assert.equal(
    fallback.evidence.assignment_validation.used_full_fallback,
    true,
  );
  assert.deepEqual(fallback.rays, []);
  assert.equal(
    validate_representative_assignments(unit, f, candidate, { max_points: 16 })
      .status,
    "assignments_pending",
  );
  assert.equal(
    validate_representative_assignments(unit, f, candidate, {
      maximum_depth: 48,
    }).status,
    "assignments_pending",
  );
  const fixed = discover_representative_orbital(unit, family("0/1"));
  const attracting = {
    ...fixed,
    candidate: canonical_orbital(unit, [{ re: "0", im: "0" }], 128),
  };
  assert.equal(
    validate_representative_assignments(unit, family("0/1"), attracting).status,
    "assignments_pending",
  );
  let stop = false;
  const cancelled = validate_representative_assignments(unit, f, candidate, {
    cancelled: () => stop,
    on_progress: () => {
      stop = true;
    },
  });
  assert.equal(cancelled.status, "cancelled");
  assert.deepEqual(cancelled.landing_ratios, []);
  assert.throws(
    () => validate_representative_assignments({ x: -1, y: 0 }, f, candidate),
    /invalid_assignment_candidate/,
  );
  assert.throws(
    () => landing_assignment_profile({ max_attempts: 1000 }),
    /invalid_assignment_profile/,
  );
});
