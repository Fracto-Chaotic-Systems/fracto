import assert from "node:assert/strict";
import test from "node:test";

import FractoOrbitalPoints from "../sdk/FractoOrbitalPoints.js";
import * as sdk from "../sdk/index.js";

test("SDK exports one detector-to-orbital-points interface", () => {
  assert.equal(typeof FractoOrbitalPoints, "function");
  assert.equal(sdk.FractoOrbitalPoints, FractoOrbitalPoints);
});

test("default path carries SDK cardinality evidence into Newton", () => {
  const result = FractoOrbitalPoints(
    { re: "0.3237686467", im: "0.0535461409" },
    { newton_limit: 1 },
  );
  assert.equal(result.status, "cardinality_passed_to_newton");
  assert.equal(result.detection.candidate_cardinality, 92);
  assert.equal(result.cardinality, 92);
  assert.equal(result.cardinality_source, "sdk_critical_orbit_return_detector");
  assert.equal(result.newton_big_complex.cardinality, 92);
  assert.equal(result.newton_big_complex.point_list.length, 92);
});

test("explicit candidate source is preserved and supports both solver modes", () => {
  const result = FractoOrbitalPoints(
    { x: "0", y: "0" },
    {
      cardinality: 1,
      cardinality_source: "verified_fixture",
      newton_mode: "both",
      newton_limit: 1,
    },
  );
  assert.equal(result.detection, null);
  assert.equal(result.cardinality, 1);
  assert.equal(result.newton_native.diagnostics.cardinality_source, "verified_fixture");
  assert.equal(result.newton_big_complex.diagnostics.cardinality_source, "verified_fixture");
  assert.equal(result.newton_native.point_list.length, 1);
  assert.equal(result.newton_big_complex.point_list.length, 1);
});

test("invalid candidate cardinality is rejected before Newton runs", () => {
  const result = FractoOrbitalPoints(
    { re: 0, im: 0 },
    { cardinality: 0 },
  );
  assert.equal(result.status, "invalid_cardinality");
  assert.equal(result.newton, null);
});

test("BigComplex refinement preserves coordinate digits beyond Number precision", () => {
  const exact_parameter = "0.2500000000000000000000000000000000000000000000000000000000000000000000000001";
  const result = FractoOrbitalPoints(
    { re: exact_parameter, im: "0" },
    {
      cardinality: 1,
      newton_mode: "big_complex",
      newton_limit: 10,
      precision_digits: 100,
    },
  );
  const output = result.newton_big_complex.point_list[0].re.toString();
  assert.equal(result.newton_big_complex.diagnostics.precision_digits, 100);
  assert.ok(output.length > 35);
  assert.notEqual(output, Number(output).toString());
});
