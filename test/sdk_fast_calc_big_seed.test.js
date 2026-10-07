import assert from "node:assert/strict";
import test from "node:test";

import FractoFastCalc from "../sdk/FractoFastCalc.js";

test("high-precision seeded calculator preserves decimal digits through iteration", () => {
  const result = FractoFastCalc.calc_big_complex_from_seed(
    "0",
    "0",
    "0.12345678901234567890123456789",
    "0",
    {
      precision_digits: 80,
      transient_limit: 0,
      iteration_cap: 2,
      tolerance: "1",
    },
  );

  assert.equal(result.status, "cycle_candidate");
  assert.equal(result.precision_digits, 80);
  assert.equal(result.pattern, 1);
  assert.notEqual(result.recurrence_residual, "0");
  assert.ok(Number(result.recurrence_residual) < 1);
  assert.ok(result.orbital_points[0].x.length > 30);
  assert.notEqual(
    result.orbital_points[0].x,
    String(Number(result.orbital_points[0].x)),
  );
});

test("high-precision seeded calculator reports a bounded escape", () => {
  const result = FractoFastCalc.calc_big_complex_from_seed(2, 0, 0, 0, {
    precision_digits: 64,
    transient_limit: 0,
    iteration_cap: 20,
    tolerance: "1e-40",
  });
  assert.equal(result.status, "escaped");
  assert.equal(result.pattern, 0);
  assert.equal(result.iteration, 3);
});

test("high-precision seeded calculator leaves an unresolved orbit explicit", () => {
  const result = FractoFastCalc.calc_big_complex_from_seed(0.1, 0.2, 0.3, 0.4, {
    precision_digits: 64,
    transient_limit: 2,
    iteration_cap: 5,
    tolerance: "1e-60",
  });
  assert.equal(result.status, "unresolved");
  assert.equal(result.estimated, true);
  assert.equal(result.iteration, 5);
});

test("high-precision seeded calculator recognizes a slow one-point convergence", () => {
  const result = FractoFastCalc.calc_big_complex_from_seed(
    "0.2581380888",
    "0.0022098423",
    "0.50",
    "0.00",
    {
      precision_digits: 64,
      iteration_cap: 10000,
      transient_limit: 5000,
      tolerance: "1e-30",
    },
  );

  assert.equal(result.status, "cycle_candidate");
  assert.equal(result.pattern, 1);
  assert.ok(Number(result.recurrence_residual) <= 1e-30);
  assert.equal(result.orbital_points.length, 2);
  assert.deepEqual(result.orbital_points[0], result.orbital_points[1]);
});
