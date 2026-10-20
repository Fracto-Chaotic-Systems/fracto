import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { find_minibrot_rays } from "../sdk/orbitals/FractoMinibrotRays.js";
import assert from "node:assert/strict";
import { tuned_tip_angles } from "../sdk/orbitals/FractoParameterTuning.js";
import {
  find_antenna_tip_rays,
  refine_antenna_tip,
} from "../sdk/orbitals/FractoAntennaRays.js";
import {
  rational_angle as angle,
  distance,
} from "../sdk/orbitals/FractoRayGeometry.js";
import { critical } from "../sdk/orbitals/FractoParameterAttachment.js";
const cases = [
  {
    core: { x: 0, y: 0 },
    period: 1,
    roots: [angle(0, 1)],
    keys: ["1/2"],
    tip: { x: -2, y: 0 },
  },
  {
    core: { x: -1, y: 0 },
    period: 2,
    roots: [angle(1, 3), angle(2, 3)],
    keys: ["5/12", "7/12"],
    tip: { x: -1.5436890126920764, y: 0 },
  },
  {
    core: { x: -0.122561166876, y: 0.74486176662 },
    period: 3,
    roots: [angle(1, 7), angle(2, 7)],
    keys: ["9/56", "15/56"],
    tip: { x: -0.10109636384562219, y: 0.9562865108091415 },
  },
];
for (const c of cases)
  test(`period-${c.period} tuned antenna rays reach the verified preperiodic tip`, () => {
    const angles = tuned_tip_angles(c.roots, c.period);
    assert.deepEqual(angles.map((a) => a.key).sort(), c.keys.slice().sort());
    const result = find_antenna_tip_rays(c.core, c.period, {
      root_angles: c.roots,
      tolerance: 1e-5,
    });
    assert.equal(result.status, "complete");
    assert.equal(result.endpoint_kind, "misiurewicz");
    assert.ok(distance(result.root, c.tip) < 1e-10);
    assert.ok(
      distance(
        critical(result.root, 3 * c.period).z,
        critical(result.root, 2 * c.period).z,
      ) < 1e-8,
    );
    for (const ray of result.rays) {
      assert.equal(ray.landed, true);
      assert.ok(ray.endpoint_error < 1e-5);
    }
  });
test("tip tuning remains exact at parent period twenty", () => {
  const d = (1n << 20n) - 1n;
  const result = tuned_tip_angles([angle(1n, d), angle(2n, d)], 20);
  assert.equal(result.length, 2);
  assert.equal(
    BigInt(result[0].numerator) * ((1n << 20n) * d),
    (2n * d + 1n) * BigInt(result[0].denominator),
  );
});
test("tip discovery requires verified root angles and valid inputs", () => {
  assert.equal(
    find_antenna_tip_rays({ x: 0, y: 0 }, 1).status,
    "root_angles_required",
  );
  assert.equal(find_antenna_tip_rays({ x: 0, y: 0 }, 21).status, "unsupported");
  assert.throws(() => refine_antenna_tip({ x: 0, y: 0 }, 1), /tip_unresolved/);
});

test("facade opt-in adds tip rays without changing default groups", () => {
  const basic = find_minibrot_rays({ x: 0, y: 0 }, 1);
  assert.equal(basic.antenna_tip, undefined);
  const result = find_minibrot_rays({ x: 0, y: 0 }, 1, { include_tip: true });
  assert.equal(result.antenna_tip.status, "complete");
  assert.equal(result.rays.length, basic.rays.length + 1);
  assert.equal(result.antenna_tip.rays[0].angle.key, "1/2");
});
test("unverified endpoint preserves prefixes and never claims landing", () => {
  const source = readFileSync(
    new URL("../sdk/orbitals/FractoAntennaRays.js", import.meta.url),
    "utf8",
  )
    .replace(/^import[\s\S]*?;\r?\n/gm, "")
    .replace(/export function /g, "function ");
  const prefix = {
    angle: angle(1, 2),
    points: [
      { x: -4, y: 0 },
      { x: 0, y: 0 },
    ],
    landed: true,
  };
  const find = vm.runInNewContext(source + ";find_antenna_tip_rays", {
    tuned_tip_angles: () => [angle(1, 2)],
    trace_parameter_ray: () => prefix,
    trace_parameter_ray_group: () => ({ status: "complete", rays: [prefix] }),
    finite: (p) => Number.isFinite(p?.x) && Number.isFinite(p?.y),
    critical: () => {
      throw Error("tip_unresolved");
    },
  });
  const result = find({ x: 0, y: 0 }, 1, { root_angles: [angle(0, 1)] });
  assert.equal(result.status, "incomplete");
  assert.equal(result.endpoint_status, "tip_unresolved");
  assert.equal(result.rays[0].landed, false);
  assert.equal(result.rays[0].points.length, 2);
});
