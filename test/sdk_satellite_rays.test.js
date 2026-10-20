import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { find_satellite_wake_rays } from "../sdk/orbitals/FractoSatelliteRays.js";
import { find_minibrot_rays } from "../sdk/orbitals/FractoMinibrotRays.js";
import { tuned_wake_angles } from "../sdk/orbitals/FractoParameterTuning.js";
import { rational_angle, distance } from "../sdk/orbitals/FractoRayGeometry.js";

for (const [core, period, rotation, root, expected] of [
  [
    { x: 0, y: 0 },
    1,
    "1/3",
    { x: -0.125, y: Math.sqrt(27) / 8 },
    ["1/7", "2/7"],
  ],
  [
    { x: 0, y: 0 },
    1,
    "2/3",
    { x: -0.125, y: -Math.sqrt(27) / 8 },
    ["5/7", "6/7"],
  ],
  [
    { x: -1, y: 0 },
    2,
    "1/3",
    { x: -1.125, y: Math.sqrt(3) / 8 },
    ["22/63", "25/63"],
  ],
  [
    { x: -1, y: 0 },
    2,
    "2/3",
    { x: -1.125, y: -Math.sqrt(3) / 8 },
    ["38/63", "41/63"],
  ],
])
  test(`period-${period} component traces its local ${rotation} wake`, () => {
    const root_angles =
      period === 1
        ? [rational_angle(0, 1)]
        : [rational_angle(1, 3), rational_angle(2, 3)];
    const result = find_satellite_wake_rays(core, period, rotation, {
      root_angles,
      tolerance: 0.002,
    });
    assert.equal(result.status, "complete");
    assert.equal(result.period, 3 * period);
    assert.equal(result.rotation, rotation);
    assert.ok(distance(result.root, root) < 1e-10);
    assert.deepEqual(
      result.rays.map((ray) => ray.angle.key),
      expected,
    );
    for (const ray of result.rays) {
      assert.equal(ray.landed, true);
      assert.ok(distance(ray.points.at(-1), root) < 0.002);
      assert.ok(
        ray.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
      );
    }
  });

test("triple-block fractions retain exact integers beyond Number precision", () => {
  const base = 1n << 20n,
    D = base - 1n;
  const [angle] = tuned_wake_angles(
    [rational_angle(1, D), rational_angle(2, D)],
    20,
    ["001", "010"],
  );
  const expected = base * base + base + 2n,
    denominator = base ** 3n - 1n;
  assert.ok(denominator > BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(
    BigInt(angle.numerator) * denominator,
    expected * BigInt(angle.denominator),
  );
});
test("third-period wakes require root angles and reject unsupported input", () => {
  const missing = find_satellite_wake_rays({ x: -1, y: 0 }, 2, "1/3");
  assert.equal(missing.status, "root_angles_required");
  assert.deepEqual(missing.rays, []);
  const unsupported = find_satellite_wake_rays({ x: 0, y: 0 }, 1, "1/4");
  assert.equal(unsupported.status, "unsupported");
  assert.deepEqual(unsupported.rays, []);
});
test("selected period-16 view can include both third-period wakes beside existing rays", () => {
  const tolerance = 0.000005015;
  const result = find_minibrot_rays(
    { x: 0.273428557437, y: 0.595445688613 },
    16,
    { tolerance, include_thirds: true },
  );
  assert.equal(result.status, "complete");
  assert.equal(result.rays.length, 8);
  assert.equal(result.root_access.rays.length, 2);
  assert.equal(result.doubling.rays.length, 2);
  for (const rotation of ["1/3", "2/3"]) {
    const group = result.thirds[rotation];
    assert.equal(group.status, "complete");
    assert.equal(group.period, 48);
    assert.equal(group.rays.length, 2);
    assert.equal(group.angle_source, "root_tuning");
    for (const ray of group.rays)
      assert.ok(distance(ray.points.at(-1), group.root) < tolerance);
  }
});
test("an unresolved third wake preserves every other available path", () => {
  const root = { status: "complete", rays: [{ angle: rational_angle(1, 3) }] },
    doubling = { status: "complete", rays: [{ angle: rational_angle(2, 5) }] };
  const find = vm.runInNewContext(`(${find_minibrot_rays.toString()})`, {
    find_component_root_rays: () => root,
    find_doubling_rays: () => doubling,
    find_satellite_wake_rays: (_c, _p, rotation, options) => {
      assert.equal(options.root_angles[0], root.rays[0].angle);
      return {
        rotation,
        status: rotation === "1/3" ? "angles_unresolved" : "incomplete",
        rays:
          rotation === "1/3"
            ? []
            : [{ landed: false, angle: rational_angle(38, 63) }],
      };
    },
  });
  const result = find({ x: -1, y: 0 }, 2, { include_thirds: true });
  assert.equal(result.status, "partial");
  assert.equal(result.rays.length, 3);
  assert.equal(result.thirds["1/3"].status, "angles_unresolved");
  assert.equal(result.thirds["2/3"].status, "incomplete");
});
