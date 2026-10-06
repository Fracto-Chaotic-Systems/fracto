import assert from "node:assert/strict";
import test from "node:test";

import FractoCardinality from "../sdk/FractoCardinality.js";
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

test("cardinality detector reports when a request lies outside the main cardioid", () => {
  const result = FractoCardinality({ re: 2, im: 0 });
  assert.equal(result.domain, "outside_main_cardioid");
  assert.equal(result.diagnostics.domain, "outside_main_cardioid");
  assert.equal(result.escaped, true);
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
  const result = FractoCardinality({ re: "-1", im: "0" });

  assert.equal(result.detection.candidate_cardinality, 2);
  assert.equal(result.detection.pyramid_coherence, 0);
  assert.equal(result.detection.pyramid_magnitude_coherence, 1);
  assert.equal(result.detection.legacy_ambiguous, true);
  assert.equal(result.detection.ambiguous, false);
  assert.deepEqual(result.diagnostics.checked_horizons, [4096]);
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
