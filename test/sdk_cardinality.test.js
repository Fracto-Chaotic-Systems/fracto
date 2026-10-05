import assert from "node:assert/strict";
import test from "node:test";

import FractoCardinality from "../sdk/FractoCardinality.js";
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
