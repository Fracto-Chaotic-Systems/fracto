import test from "node:test";
import assert from "node:assert/strict";
import { newton_derived } from "../sdk/orbitals/FractoNewtonDerived.js";
import { newton_big_complex } from "../sdk/orbitals/FractoNewtonBigComplex.js";

const coordinates = (result) =>
  result.point_list.map(({ re, im }) => [Number(re), Number(im)]);

test("Newton uses the supplied seed to select the fixed point at c=0", () => {
  const point = { x: 0, y: 0 };
  const zero = newton_big_complex(point, 10, 1, { seed: { x: 0, y: 0 } });
  const one = newton_big_complex(point, 10, 1, { seed: { re: "1", im: "0" } });
  assert.equal(zero.closure_reached,true);
  assert.equal(zero.status,"closure_reached");
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

test("unclosed BigComplex estimate is explicitly rejected with no usable orbital", () => {
  const result=newton_big_complex({x:0.3677540133,y:0.23766438924},1,6,{seed:{x:-0.1746988,y:-1.0180723},precision_digits:64});
  assert.equal(result.status,"closure_not_reached");
  assert.equal(result.closure_reached,false);
  assert.ok(result.closure_error>result.closure_tolerance || result.closure_error===null);
  assert.equal(result.cardinality,0);
  assert.equal(result.candidate_cardinality,6);
  assert.deepEqual(result.point_list,[]);
});

test("native Newton likewise rejects a nonclosing estimate", () => {
  const result=newton_derived({x:0.2,y:0.3},1,1);
  assert.equal(result.closure_reached,false);
  assert.equal(result.status,"closure_not_reached");
  assert.deepEqual(result.point_list,[]);
  assert.equal(result.cardinality,0);
});

test("Decimal best-iterate selection retains accurate closure before an exact-zero step", () => {
  const result=newton_big_complex({x:0.2,y:0.3},10,1);
  assert.equal(result.closure_reached,true);
  assert.ok(result.closure_error<=result.closure_tolerance);
  assert.equal(result.point_list.length,1);
});
