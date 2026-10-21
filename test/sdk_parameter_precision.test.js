import test from "node:test";
import { trace_parameter_ray } from "../sdk/orbitals/FractoParameterRayTrace.js";
import assert from "node:assert/strict";
import { find_minibrot_rays } from "../sdk/orbitals/FractoMinibrotRays.js";
import { component_attachment } from "../sdk/orbitals/FractoParameterAttachment.js";
import { big_component_attachment } from "../sdk/orbitals/FractoParameterBigAttachment.js";
import { big_attachment_angles } from "../sdk/orbitals/FractoParameterBigAngles.js";
import {
  satellite_parent,
  rotation_words,
} from "../sdk/orbitals/FractoParameterParent.js";
import { component_root_angles } from "../sdk/orbitals/FractoParameterRootAngles.js";
import {
  parameter_math,
  parameter_distance,
  MAX_PARAMETER_PERIOD,
} from "../sdk/orbitals/FractoParameterPrecision.js";
import {
  parameter_reference,
  decimal_parameter_sample,
} from "../sdk/orbitals/FractoParameterRaySolver.js";
import { rational_angle } from "../sdk/orbitals/FractoRayGeometry.js";
import { tuned_wake_angles } from "../sdk/orbitals/FractoParameterTuning.js";

for (const [period, core] of [
  [21, { x: 0.2713568223215816, y: 0.006228315276223591 }],
  [32, { x: -1.4002530812147828, y: 0 }],
])
  test(`period-${period} completes root, three satellite wakes and antenna tip`, () => {
    const progress = [];
    const result = find_minibrot_rays(core, period, {
      include_thirds: true,
      include_tip: true,
      tolerance: 1e-5,
      on_progress: (s) => progress.push(s),
    });
    assert.equal(result.status, "complete");
    assert.equal(result.rays.length, 10);
    assert.ok(progress.includes("combinatorial_angles"));
    for (const group of [
      result.root_access,
      result.doubling,
      ...Object.values(result.thirds),
      result.antenna_tip,
    ]) {
      assert.equal(group.status, "complete");
      assert.equal(group.root.precision, 80);
      assert.ok(group.root.exact.x.length > 20);
      for (const ray of group.rays) {
        assert.equal(ray.landed, true);
        assert.ok(ray.endpoint_error < 1e-5);
      }
    }
  });

test("Decimal exterior discovery reproduces the analytic period-two root angles", () => {
  const attachment = big_component_attachment({ x: -1, y: 0 }, 2, 1);
  const angles = big_attachment_angles(attachment, 2, {
    angle_period: 2,
    shrink: 0.8,
  });
  assert.deepEqual(angles.map((a) => a.key).sort(), ["1/3", "2/3"]);
});

test("period-32 ancestry identifies its period-16 parent and exact root angles", () => {
  const attachment = component_attachment(
    {
      x: "-1.4002530812147827973250122828087781669493137414540208174704348709290784363540501",
      y: "0",
    },
    32,
    1,
  );
  const parent = satellite_parent(attachment.root, 32);
  assert.equal(parent.period, 16);
  assert.equal(parent.numerator, 1);
  assert.equal(parent.denominator, 2);
  assert.deepEqual(
    component_root_angles(attachment, 32)
      .map((a) => a.key)
      .sort(),
    ["27031/65537", "38506/65537"],
  );
  assert.deepEqual(rotation_words(2, 5), ["01001", "01010"]);
  assert.deepEqual(rotation_words(2, 3), ["101", "110"]);
});

test("exact coordinates survive reference caching and sub-ulp sample refinement", () => {
  const a = {
    x: -1,
    y: 0,
    exact: { x: "-1.00000000000000000001", y: "0" },
    precision: 80,
  };
  const b = { ...a, exact: { x: "-1.00000000000000000002", y: "0" } };
  assert.ok(parameter_distance(a, b) > 0);
  const ar = parameter_reference(a, 64),
    br = parameter_reference(b, 64);
  assert.notEqual(ar, br);
  const m = parameter_math(),
    delta = { x: 1e-22, y: 2e-22 };
  const target = m.pack(m.critical(m.add(m.point(a), m.point(delta)), 9).z);
  const solved = decimal_parameter_sample({ x: 0, y: 0 }, 9, ar, target);
  assert.ok(solved);
  assert.ok(Math.abs(solved.x - delta.x) < 1e-30);
  assert.ok(Math.abs(solved.y - delta.y) < 1e-30);
});

test("period policy rejects above 32 while exact tuning supports 96-bit denominators", () => {
  assert.equal(MAX_PARAMETER_PERIOD, 32);
  for (const x of [null, "", false, "NaN"])
    assert.equal(find_minibrot_rays({ x, y: 0 }, 1).status, "unsupported");
  assert.equal(find_minibrot_rays({ x: 0, y: 0 }, 33).status, "unsupported");
  const d = (1n << 32n) - 1n;
  const angles = tuned_wake_angles(
    [rational_angle(1, d), rational_angle(2, d)],
    32,
    ["001", "010"],
  );
  const full = (1n << 96n) - 1n;
  assert.equal(
    BigInt(angles[0].numerator) * full,
    ((1n << 64n) + (1n << 32n) + 2n) * BigInt(angles[0].denominator),
  );
});

test("decimal-string trace targets and wall-clock stops preserve their contracts", () => {
  const ray = trace_parameter_ray(
    rational_angle(1, 2),
    { x: "-2", y: "0" },
    0.001,
  );
  assert.equal(ray.landed, true);
  assert.ok(ray.endpoint_error < 0.001);
  const original = Date.now;
  let ticks = 0;
  try {
    Date.now = () => ++ticks;
    const partial = trace_parameter_ray(
      rational_angle(1, 3),
      { x: -0.75, y: 0 },
      1e-12,
      { allow_partial: true, time_budget_ms: 2 },
    );
    assert.equal(partial.landed, false);
    assert.equal(partial.stop_reason, "trace_budget");
    assert.ok(partial.points.length > 1);
  } finally {
    Date.now = original;
  }
});
