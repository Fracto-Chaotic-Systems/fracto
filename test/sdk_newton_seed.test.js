import test from "node:test";
import assert from "node:assert/strict";
import { newton_big_complex } from "../sdk/orbitals/FractoNewtonBigComplex.js";

const coordinates = (result) =>
  result.point_list.map(({ re, im }) => [Number(re), Number(im)]);

test("Newton uses the supplied seed to select the fixed point at c=0", () => {
  const point = { x: 0, y: 0 };
  const zero = newton_big_complex(point, 10, 1, { seed: { x: 0, y: 0 } });
  const one = newton_big_complex(point, 10, 1, { seed: { re: "1", im: "0" } });
  assert.deepEqual(coordinates(zero), [[0, 0]]);
  assert.deepEqual(coordinates(one), [[1, 0]]);
  assert.deepEqual(
    coordinates(newton_big_complex(point, 10, 1)),
    coordinates(zero),
  );
});

test("invalid seeds return no Newton points", () => {
  for (const seed of [{ x: NaN, y: 0 }, { x: Infinity, y: 0 }, { x: 1 }]) {
    const result = newton_big_complex({ x: 0, y: 0 }, 10, 1, { seed });
    assert.equal(result.status, "invalid_seed");
    assert.deepEqual(result.point_list, []);
  }
});
