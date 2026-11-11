import test from "node:test";
import assert from "node:assert/strict";
import {
  discover_representative_orbital,
  representative_ray_profile,
} from "../sdk/orbitals/FractoRepresentativeRaySolver.js";
import {
  create_dynamic_ray_tracer,
  trace_dynamic_ray,
} from "../sdk/orbitals/FractoDynamicRayTrace.js";
import {
  build_denominator_catalog,
  catalog_doubling_families,
} from "../sdk/orbitals/FractoDenominatorCatalog.js";
import { orbital_closure_error } from "../sdk/orbitals/FractoOrbitalIdentity.js";
import { newton_big_complex } from "../sdk/orbitals/FractoNewtonBigComplex.js";
const families = [
  ...catalog_doubling_families(
    build_denominator_catalog({ max_denominator: 163 }),
  ),
];
const family = (key) => families.find((entry) => entry.key === key);

test("representative solver discovers analytic primitive cycles with pending assignments and no full paths", () => {
  for (const [key, period] of [
    ["0/1", 1],
    ["1/3", 2],
    ["1/5", 4],
    ["1/7", 3],
  ]) {
    const result = discover_representative_orbital(
      { x: "0", y: "0" },
      family(key),
    );
    assert.equal(result.status, "orbital_candidate", key);
    assert.equal(result.candidate.period, period);
    assert.ok(
      Number(orbital_closure_error({ x: 0, y: 0 }, result.candidate.points)) <
        1e-24,
    );
    const theta =
      (2 * Math.PI * Number(family(key).numerator)) /
      Number(family(key).denominator);
    const point = result.candidate.points[result.representative.point_index];
    assert.ok(
      Math.hypot(
        Number(point.re) - Math.cos(theta),
        Number(point.im) - Math.sin(theta),
      ) < 1e-12,
    );
    assert.equal(result.lifecycle_state.orbital, "validated");
    assert.equal(result.lifecycle_state.assignments, "pending");
    assert.equal(result.lifecycle_state.paths.status, "missing");
    assert.equal(result.evidence.association, "pending");
    assert.deepEqual(result.rays, []);
    assert.deepEqual(result.landing_ratios, []);
    assert.equal(result.statistics.traces_started, 1);
    assert.ok(result.statistics.retained_points <= 16);
    assert.ok(result.representative.depth < 128);
  }
});

test("basilica angle period two finds a primitive fixed-point orbital", () => {
  const result = discover_representative_orbital(
    { x: -1, y: 0 },
    family("1/3"),
  );
  assert.equal(result.status, "orbital_candidate");
  assert.equal(result.candidate.period, 1);
  assert.ok(
    Math.abs(Number(result.candidate.points[0].re) - (1 - Math.sqrt(5)) / 2) <
      1e-14,
  );
});

test("exact parameter strings and non-power-of-two precision profiles are preserved", () => {
  const parameter = {
    x: "-0.10000000000000000000000000000000000012345",
    y: "0.2000000000000000000000000000000000006789",
  };
  const result = discover_representative_orbital(parameter, family("0/1"), {
    minimum_precision: 100,
    precision_digits: 100,
    maximum_precision: 100,
  });
  assert.equal(result.status, "orbital_candidate");
  assert.deepEqual(result.parameter, parameter);
  assert.equal(result.candidate.precision_digits, 100);
  assert.ok(
    Number(orbital_closure_error(parameter, result.candidate.points)) < 1e-24,
  );
});

test("adaptive approach rejects the nearby wrong period-29 candidate and recovers period 58", () => {
  const result = discover_representative_orbital(
    { x: 0, y: 0 },
    family("1/59"),
  );
  assert.equal(result.status, "orbital_candidate");
  assert.equal(result.candidate.period, 58);
  assert.ok(
    result.refinement_attempts.some(
      (attempt) =>
        attempt.period === 29 &&
        attempt.reason === "representative_not_converged",
    ),
  );
  assert.ok(result.candidate.precision_digits >= 128);
  assert.equal(result.statistics.traces_started, 1);
});

test("the former 162-ray blocker yields a compact validated candidate without tracing its siblings", () => {
  const parameter = { x: "-0.5629527505984927", y: "0.47148116383941135" };
  const result = discover_representative_orbital(parameter, family("1/163"));
  assert.equal(result.status, "orbital_candidate");
  assert.equal(result.candidate.period, 162);
  assert.ok(
    Number(orbital_closure_error(parameter, result.candidate.points)) < 1e-24,
  );
  assert.equal(result.statistics.traces_started, 1);
  assert.ok(result.statistics.retained_points <= 16);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 100000);
});

test("continued rays preserve branch endpoints and cumulative sample budgets with bounded history", () => {
  const c = { x: -1, y: 0 },
    angle = family("1/3").angles[0];
  const tracer = create_dynamic_ray_tracer(c, angle, {
    retain_geometry: false,
    verify_precision: true,
    max_points: 6000,
  });
  const first = tracer.advance(2 ** -12),
    second = tracer.advance(2 ** -44);
  const fresh = trace_dynamic_ray(c, angle, {
    minimum_potential: 2 ** -44,
    verify_precision: true,
    max_points: 6000,
  });
  assert.ok(second.sample_count > first.sample_count);
  assert.ok(second.points.length <= 16);
  assert.ok(
    Math.hypot(
      second.endpoint.x - fresh.endpoint.x,
      second.endpoint.y - fresh.endpoint.y,
    ) < 1e-13,
  );
  assert.throws(
    () => tracer.advance(2 ** -12),
    /invalid_ray_continuation_potential/,
  );
  const bounded = create_dynamic_ray_tracer(c, angle, {
    max_points: 16,
    retain_geometry: false,
  });
  const stopped = bounded.advance(2 ** -12),
    again = bounded.advance(2 ** -44);
  assert.equal(stopped.reason, "point_limit");
  assert.equal(again.sample_count, 16);
});

test("limits, disconnection and cancellation leave no guessed candidates", () => {
  const c = { x: 0, y: 0 },
    f = family("1/59");
  const bounded = discover_representative_orbital(c, f, { max_points: 16 });
  assert.equal(bounded.status, "unresolved");
  assert.equal(bounded.reason, "point_limit");
  assert.equal(bounded.candidate, undefined);
  assert.equal(
    discover_representative_orbital(c, f, { max_refinement_period: 24 }).reason,
    "refinement_period_limit",
  );
  assert.equal(
    discover_representative_orbital(c, family("0/1"), { maximum_depth: 28 })
      .status,
    "unresolved",
  );
  assert.equal(
    discover_representative_orbital(c, family("1/163"), {
      precision_digits: 64,
      maximum_precision: 64,
    }).reason,
    "precision_limit",
  );
  assert.equal(
    discover_representative_orbital({ x: 3, y: 0 }, f).status,
    "disconnected",
  );
  let stop = false;
  const cancelled = discover_representative_orbital(c, f, {
    cancelled: () => stop,
    on_progress: () => {
      stop = true;
    },
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.statistics.newton_attempts, 0);
  assert.equal(
    newton_big_complex(c, 80, 58, {
      seed: { re: "1.001", im: "0.1" },
      cancelled: () => true,
    }).status,
    "cancelled",
  );
  for (const options of [
    { depth_step: 0 },
    { maximum_depth: 2048 },
    { precision_digits: 513 },
    { probe_iterations: 101 },
  ])
    assert.throws(
      () => representative_ray_profile(options),
      /invalid_representative_profile/,
    );
});
