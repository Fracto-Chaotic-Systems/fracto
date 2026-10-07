import assert from "node:assert/strict";
import test from "node:test";

import FractoFastCalc from "../sdk/FractoFastCalc.js";
import FractoCardinality from "../sdk/FractoCardinality.js";
import { sample_orbit } from "../sdk/orbitals/FractoOrbitSampling.js";
import { detect_return_cardinality } from "../sdk/orbitals/FractoReturnDetection.js";
import * as sdk from "../sdk/index.js";

test("SDK exposes one adaptive main-cardioid cardinality function", () => {
  assert.equal(typeof FractoCardinality, "function");
  assert.equal(sdk.FractoCardinality, FractoCardinality);
});

test("adaptive cardinality detection resolves the weak short-window candidate", () => {
  const result = FractoCardinality({
    re: "0.3237686467",
    im: "0.0535461409",
  });
  assert.equal(result.status, "cardinality_detected");
  assert.equal(result.detection.candidate_cardinality, 92);
  assert.deepEqual(result.diagnostics.checked_horizons, [4096, 8192, 16384]);
  assert.equal(result.diagnostics.evidence_gate_passed, true);
  assert.equal(result.diagnostics.mathematical_proof, false);
  assert.deepEqual(result.samples[0], {
    iteration: 0,
    re: 0,
    im: 0,
    radius: 0,
  });
  assert.equal(result.diagnostics.detector, "critical_orbit_return");
  assert.equal(result.detection.pyramid_coherence, 1);
  assert.equal(result.detection.pyramid_layer_diagnostics.length, 10);
  assert.equal(
    result.detection.pyramid_layer_diagnostics[0].finite_difference_order,
    1,
  );
  assert.ok(
    result.detection.pyramid_layer_diagnostics[0].positive_change_magnitude >=
      0,
  );
});

test("cardinality detection can sample from a supplied complex seed", () => {
  const seed = { re: "0.25", im: "-0.125" };
  const result = FractoCardinality(
    { re: "-0.5", im: "0.1" },
    { seed, iterations: 32, adaptive_detection: false },
  );

  assert.deepEqual(result.seed, seed);
  assert.deepEqual(result.samples[0], {
    iteration: 0,
    re: 0.25,
    im: -0.125,
    radius: Math.hypot(0.25, -0.125),
  });
  assert.equal(result.diagnostics.detector, "seeded_orbit_return");
  assert.equal(result.diagnostics.seed_strategy, "caller_supplied");
});

test("cardinality rejects malformed supplied seeds", () => {
  const result = FractoCardinality(
    { re: "-0.5", im: "0.1" },
    { seed: { re: "bad", im: "0" } },
  );
  assert.equal(result.status, "invalid_input");
  assert.equal(result.diagnostics.reason, "seed_coordinates_must_be_finite_numbers");
});

test("contiguous iteration lookup preserves the normal return-detector result", () => {
  const orbit = sample_orbit(
    { re: "-0.5", im: "0.1" },
    { iterations: 4096, seed: { re: "0.25", im: "-0.125" } },
  );
  assert.deepEqual(
    detect_return_cardinality(orbit.samples, { contiguous_iterations: true }),
    detect_return_cardinality(orbit.samples),
  );
});

test("exact fixed-point-basin input returns an ambiguous 16-gap candidate", () => {
  const result = FractoCardinality({
    re: "0.22700118863600927",
    im: "0.24308664073329525",
  });

  assert.equal(result.status, "cardinality_detected");
  assert.equal(result.detection.candidate_cardinality, 16);
  assert.equal(result.detection.ambiguous, true);
  assert.equal(result.detection.matching_gaps, 15);
  assert.equal(result.detection.gap_gcd, 16);
  assert.deepEqual(result.diagnostics.checked_horizons, [
    4096,
    8192,
    16384,
    32768,
    65536,
    131072,
    262144,
  ]);
  const alternative_cardinalities = result.detection.alternatives.map(
    ({ cardinality }) => cardinality,
  );
  assert.ok([5, 21, 37].every((candidate) =>
    alternative_cardinalities.includes(candidate),
  ));
  assert.ok(
    result.detection.alternatives.every(({ recurrence_error }) =>
      recurrence_error === 0,
    ),
  );
});

test("cardinality returns FractoFastCalc directly outside the main cardioid", () => {
  const expected = { pattern: 7, iteration: 12345, orbital_points: [] };
  const original_calc = FractoFastCalc.calc;
  const calls = [];
  FractoFastCalc.calc = (...args) => {
    calls.push(args);
    return expected;
  };
  try {
    const result = FractoCardinality({ re: "0.5", im: "0.5" });
    assert.equal(result, expected);
    assert.deepEqual(calls, [[0.5, 0.5]]);
  } finally {
    FractoFastCalc.calc = original_calc;
  }
});

test("cardinality uses the seeded calculator outside the main cardioid when requested", () => {
  const expected = { pattern: 3, iteration: 123 };
  const original_calc_from_seed = FractoFastCalc.calc_from_seed;
  const calls = [];
  FractoFastCalc.calc_from_seed = (...args) => {
    calls.push(args);
    return expected;
  };
  try {
    const result = FractoCardinality(
      { re: "0.5", im: "0.5" },
      { seed: { re: "0.2", im: "-0.1" }, seed_level: 0.125 },
    );
    assert.equal(result, expected);
    assert.deepEqual(calls, [[0.5, 0.5, 0.2, -0.1, 0.125]]);
  } finally {
    FractoFastCalc.calc_from_seed = original_calc_from_seed;
  }
});

test("fixed-horizon mode preserves the raw candidate and records its horizon", () => {
  const result = FractoCardinality(
    { re: "0.3237686467", im: "0.0535461409" },
    { adaptive_detection: false },
  );
  assert.equal(result.detection.candidate_cardinality, 10);
  assert.deepEqual(result.diagnostics.checked_horizons, [4096]);
  assert.equal(result.diagnostics.evidence_gate_passed, false);
});

test("magnitude-weighted coherence discounts small reversals and stops adaptive passes", () => {
  const result = FractoCardinality({
    re: "-0.6053682444481497",
    im: "0.3584726251091578",
  });

  assert.equal(result.detection.candidate_cardinality, 9);
  assert.equal(result.detection.pyramid_coherence, 0.4);
  assert.ok(result.detection.pyramid_magnitude_coherence > 0.9);
  assert.equal(result.detection.legacy_ambiguous, true);
  assert.equal(result.detection.ambiguous, false);
  assert.deepEqual(result.diagnostics.checked_horizons, [4096]);
  assert.equal(result.diagnostics.evidence_gate_passed, true);
});

test("magnitude-weighted coherence treats an exact stable cycle with zero swings as coherent", () => {
  const result = detect_return_cardinality(
    Array.from({ length: 128 }, (_, iteration) => ({
      iteration,
      re: iteration % 2 === 0 ? 0 : -1,
      im: 0,
      radius: iteration % 2 === 0 ? 0 : 1,
    })),
  );

  assert.equal(result.candidate_cardinality, 2);
  assert.equal(result.pyramid_coherence, 0);
  assert.equal(result.pyramid_magnitude_coherence, 1);
  assert.equal(result.legacy_ambiguous, true);
  assert.equal(result.ambiguous, false);
});

test("return detection summarizes very large matching-minima sets without argument spreading", () => {
  const minimum_count = 130_000;
  const samples = Array.from(
    { length: minimum_count * 2 + 1 },
    (_, iteration) => {
      const radius = iteration % 2 === 0 ? 2 : 1;
      return {
        iteration,
        radius,
        re: iteration % 2,
        im: 0,
      };
    },
  );

  const result = detect_return_cardinality(samples);

  assert.equal(result.status, "return_pattern_detected");
  assert.equal(result.candidate_cardinality, 2);
  assert.ok(result.matching_minima.length > 125_000);
  assert.equal(result.minimum_radius, 1);
  assert.equal(result.maximum_radius, 1);
  const first_layer = result.pyramid_layer_diagnostics[0];
  assert.equal(first_layer.finite_difference_order, 1);
  assert.equal(first_layer.scale, 0);
  assert.equal(first_layer.absolute_change_spread, 0);
  assert.equal(first_layer.positive_change_magnitude, 0);
  assert.equal(first_layer.negative_change_magnitude, 0);
  assert.equal(first_layer.ignored_change_count, first_layer.sample_count);
});
