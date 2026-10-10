import assert from "node:assert/strict";
import test from "node:test";

import { calculate_seed_survey } from "../servers/fracto-data-server/handlers/handle_orbital.js";

test("survey keeps nonzero calculator patterns separate from escaped seeds", () => {
  let calculator_calls = 0;
  const result = calculate_seed_survey(
    { x: 0.5, y: 0.5 },
    (_parameter, options) => {
      calculator_calls++;
      if (Number(options.seed.re) === -1.5 && Number(options.seed.im) === -1.5) {
        return { pattern: 4, iteration: 23, orbital_points: [] };
      }
      return { pattern: 0, iteration: 2 };
    },
  );

  assert.equal(calculator_calls, 121 * 121);
  assert.equal(result.iteration_points.length, 1);
  assert.deepEqual(result.iteration_points[0], {
    x: -1.5,
    y: -1.5,
    pattern: 4,
    iterations: 23,
  });
  assert.equal(result.escaped_points.length, 121 * 121 - 1);
});

test("estimated nonzero calculator patterns remain colored, not grey, in preview", () => {
  const result = calculate_seed_survey(
    { x: 0.5, y: 0.5 },
    (_parameter, options) =>
      Number(options.seed.re) === -1.5 && Number(options.seed.im) === -1.5
        ? { pattern: 4, iteration: 23, estimated: true }
        : { pattern: 0, iteration: 2 },
  );

  assert.deepEqual(result.iteration_points[0], {
    x: -1.5,
    y: -1.5,
    pattern: 4,
    iterations: 23,
  });
  assert.equal(result.unresolved_points.some((point) => point.x === -1.5 && point.y === -1.5), false);
  assert.equal(result.outcome_counts.unresolved, 1);
});
