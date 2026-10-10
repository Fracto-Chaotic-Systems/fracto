import assert from "node:assert/strict";
import test from "node:test";

import FractoFastCalc from "../sdk/FractoFastCalc.js";

test("calc keeps its zero-seed escape result independent of the experiment", () => {
  const original_experiment = FractoFastCalc.calc_from_seed;
  FractoFastCalc.calc_from_seed = () => {
    throw new Error("The experimental calculator must not be called by calc");
  };
  try {
    assert.deepEqual(FractoFastCalc.calc(2, 0, 0.04), {
      pattern: 0,
      iteration: 3,
    });
  } finally {
    FractoFastCalc.calc_from_seed = original_experiment;
  }
});

test("seeded calculator starts at the requested point and reports its own orbit", () => {
  const result = FractoFastCalc.calc_from_seed(-2.75, 0, 0.5, 0, 0.04);
  assert.deepEqual(result, { pattern: 0, iteration: 4 });
});

test("seeded calculator budgets its recurrence refinement within an explicit limit", () => {
  const original_refinement = FractoFastCalc.best_iteration_from_seed;
  let refinement_limit;
  FractoFastCalc.best_iteration_from_seed = (...args) => {
    refinement_limit = args[5];
    return 12;
  };
  try {
    const result = FractoFastCalc.calc_from_seed(0, 0, 0.5, 0, 10, 100000);
    assert.equal(result.iteration, 12);
    assert.equal(refinement_limit, 94999);
  } finally {
    FractoFastCalc.best_iteration_from_seed = original_refinement;
  }
});

test("zero-seed experimental call agrees with calc for an escaping input", () => {
  assert.deepEqual(
    FractoFastCalc.calc_from_seed(-2.75, 0, 0, 0, 0.04),
    FractoFastCalc.calc(-2.75, 0, 0.04),
  );
});

test("seeded recurrence extraction starts its follow-up pass from the same seed", () => {
  const zero_seed = FractoFastCalc.calc(0, 0, 0.04);
  const half_seed = FractoFastCalc.calc_from_seed(0, 0, 0.5, 0, 0.04);

  assert.equal(zero_seed.pattern, 1);
  assert.equal(half_seed.pattern, 1);
  assert.notEqual(zero_seed.iteration, half_seed.iteration);
  assert.deepEqual(half_seed.orbital_points, [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ]);
});
