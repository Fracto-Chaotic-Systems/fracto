import test from "node:test";
import assert from "node:assert/strict";
import {
  find_doubling_rays,
  trace_parameter_ray,
  trace_parameter_ray_group,
} from "../sdk/orbitals/FractoParameterRays.js";
import { doubling_attachment } from "../sdk/orbitals/FractoParameterAttachment.js";
import { rational_angle, distance } from "../sdk/orbitals/FractoRayGeometry.js";

for (const [core, period, root, angles] of [
  [{ x: 0, y: 0 }, 1, { x: -0.75, y: 0 }, ["1/3", "2/3"]],
  [{ x: -1, y: 0 }, 2, { x: -1.25, y: 0 }, ["2/5", "3/5"]],
  [
    { x: -0.12256116687665, y: 0.74486176661974 },
    3,
    { x: -0.11573542376615752, y: 0.8379990273731625 },
    ["10/63", "17/63"],
  ],
  [
    { x: -1.75487766624669, y: 0 },
    3,
    { x: -1.7685291524676852, y: 0 },
    ["4/9", "5/9"],
  ],
  [
    { x: -1.310702641336833, y: 0 },
    4,
    { x: -1.368098939391258, y: 0 },
    ["10/17", "7/17"],
  ],
])
  test(`period-${period} core ${core.x} finds its own doubling wake`, () => {
    const stages = [];
    const result = find_doubling_rays(core, period, {
      tolerance: 0.002,
      on_progress: (s) => stages.push(s),
    });
    assert.equal(result.status, "complete");
    assert.deepEqual(stages, ["attachment", "angles", "tracing"]);
    assert.deepEqual(result.rays.map((r) => r.angle.key).sort(), angles.sort());
    assert.ok(distance(result.root, root) < 1e-10);
    for (const ray of result.rays) {
      assert.ok(ray.points.length > 10);
      assert.ok(distance(ray.points.at(-1), root) < 0.002);
      assert.ok(ray.endpoint_error > 0);
      assert.ok(
        ray.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
      );
    }
  });

test("conjugate cores produce conjugate attachments and fractions", () => {
  const core = { x: -0.12256116687665, y: -0.74486176661974 };
  const result = find_doubling_rays(core, 3, { tolerance: 0.002 });
  assert.equal(result.status, "complete");
  assert.deepEqual(result.rays.map((r) => r.angle.key).sort(), [
    "46/63",
    "53/63",
  ]);
  assert.ok(result.root.y < 0);
});
test("a lower-period core, invalid data, and unsupported precision never supply rays", () => {
  for (const [core, period, options, status] of [
    [{ x: -1, y: 0 }, 4, {}, "period_mismatch"],
    [{ x: 3, y: 0 }, 1, {}, "core_unresolved"],
    [{ x: 0, y: 0 }, 33, {}, "unsupported"],
    [{ x: NaN, y: 0 }, 1, {}, "unsupported"],
    [{ x: 0, y: 0 }, 1, { tolerance: 1e-15 }, "unsupported"],
    [{ x: 0, y: 0 }, 1, { tolerance: Infinity }, "unsupported"],
  ]) {
    const result = find_doubling_rays(core, period, options);
    assert.equal(result.status, status);
    assert.deepEqual(result.rays, []);
  }
});
test("an unrelated ray is rejected instead of being connected to the target", () => {
  assert.throws(
    () =>
      trace_parameter_ray(rational_angle(1, 7), { x: -0.75, y: 0 }, 0.001, {
        max_depth: 8,
      }),
    /trace_budget/,
  );
});
test("nearby core guesses refine to the same period-two attachment", () => {
  const r = doubling_attachment({ x: -0.99, y: 0.001 }, 2);
  assert.ok(distance(r.center, { x: -1, y: 0 }) < 1e-12);
  assert.ok(distance(r.root, { x: -1.25, y: 0 }) < 1e-12);
});

// Local 0/1 access is transported to global angles, not relabelled as zero.
import {
  find_component_root_rays,
  find_minibrot_rays,
} from "../sdk/orbitals/FractoMinibrotRays.js";
for (const [core, period, angles, root] of [
  [{ x: 0, y: 0 }, 1, ["0/1"], { x: 0.25, y: 0 }],
  [{ x: -1, y: 0 }, 2, ["1/3", "2/3"], { x: -0.75, y: 0 }],
  [
    { x: -0.12256116687665, y: 0.74486176661974 },
    3,
    ["1/7", "2/7"],
    { x: -0.125, y: Math.sqrt(27) / 8 },
  ],
  [{ x: -1.75487766624669, y: 0 }, 3, ["3/7", "4/7"], { x: -1.75, y: 0 }],
  [{ x: -1.310702641336833, y: 0 }, 4, ["2/5", "3/5"], { x: -1.25, y: 0 }],
])
  test(`local 0/1 access of period ${period} at ${core.x} has global labels ${angles}`, () => {
    const result = find_component_root_rays(core, period, { tolerance: 0.002 });
    assert.equal(result.status, "complete");
    assert.deepEqual(result.rays.map((r) => r.angle.key).sort(), angles);
    assert.ok(distance(result.root, root) < 1e-6);
    for (const ray of result.rays)
      assert.ok(distance(ray.points.at(-1), root) < 0.002001);
  });
test("the main cardioid adds exactly one zero ray beside the doubling pair", () => {
  const result = find_minibrot_rays({ x: 0, y: 0 }, 1, { tolerance: 0.002 });
  assert.equal(result.status, "complete");
  assert.deepEqual(result.rays.map((r) => r.angle.key).sort(), [
    "0/1",
    "1/3",
    "2/3",
  ]);
  assert.equal(result.root_access.root.x, 0.25);
  assert.equal(result.doubling.root.x, -0.75);
});
test("root-access rejects incorrect periods and unsupported inputs", () => {
  for (const [core, n, status] of [
    [{ x: -1, y: 0 }, 4, "period_mismatch"],
    [{ x: 0, y: 0 }, 33, "unsupported"],
  ]) {
    const r = find_component_root_rays(core, n);
    assert.equal(r.status, status);
    assert.deepEqual(r.rays, []);
  }
});

test("partial access results preserve the independently verified group", async () => {
  const { runInNewContext } = await import("node:vm");
  for (const rootFails of [true, false]) {
    const verified = {
      status: "complete",
      rays: [{ angle: { key: "1/3" }, points: [] }],
    };
    const failed = { status: "trace_budget", rays: [] };
    const find = runInNewContext(`(${find_minibrot_rays.toString()})`, {
      find_doubling_rays: () => (rootFails ? verified : failed),
      find_component_root_rays: () => (rootFails ? failed : verified),
    });
    const result = find({ x: -1, y: 0 }, 2);
    assert.equal(result.status, "partial");
    assert.equal(result.rays.length, 1);
    assert.equal(result.rays[0], verified.rays[0]);
    assert.equal(
      result.root_access.status,
      rootFails ? "trace_budget" : "complete",
    );
  }
});

for (const [core, period, tolerance, angles] of [
  [
    { x: -0.044218945049, y: 0.98657429402 },
    5,
    0.00002548,
    ["166/1023", "197/1023", "5/31", "6/31"],
  ],
  [
    { x: -0.592462008286, y: 0.621344047879 },
    8,
    0.00001519,
    ["20818/65535", "21073/65535", "27/85", "82/255"],
  ],
])
  test(`reported period-${period} minibrot resolves both accesses at canvas-scale tolerance`, () => {
    const result = find_minibrot_rays(core, period, { tolerance });
    assert.equal(result.status, "complete");
    assert.equal(result.doubling.status, "complete");
    assert.equal(result.root_access.status, "complete");
    assert.deepEqual(result.rays.map((r) => r.angle.key).sort(), angles.sort());
    for (const group of [result.doubling, result.root_access])
      for (const ray of group.rays) {
        assert.ok(ray.endpoint_error < tolerance);
        assert.ok(distance(ray.points.at(-1), group.root) < tolerance);
        assert.ok(
          ray.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
        );
      }
  });

test("reference perturbations preserve parameter corrections below a global-coordinate ulp", async () => {
  const { parameter_reference, perturbed_critical } =
    await import("../sdk/orbitals/FractoParameterRaySolver.js");
  const { default: Decimal } = await import("decimal.js");
  const root = { x: -0.041718658954093546, y: 0.9860559664503621 };
  const reference = parameter_reference(root, 2048);
  const first = perturbed_critical({ x: 1e-18, y: 0 }, 1978, reference),
    second = perturbed_critical({ x: 2e-18, y: 0 }, 1978, reference);
  assert.equal(root.x + 1e-18, root.x + 2e-18);
  assert.notEqual(first.z.x, second.z.x);
  const D = Decimal.clone({ precision: 64 });
  const cr = new D(root.x).plus("0.000000000000000002"),
    ci = new D(root.y);
  let x = new D(0),
    y = new D(0);
  for (let i = 0; i < 1978; i++) {
    let next = x.mul(x).minus(y.mul(y)).plus(cr);
    y = x.mul(y).mul(2).plus(ci);
    x = next;
  }
  assert.ok(distance(second.z, { x: x.toNumber(), y: y.toNumber() }) < 1e-15);
  assert.equal(parameter_reference(root, 2048), reference);
});

import { tuned_doubling_angles } from "../sdk/orbitals/FractoParameterTuning.js";
test("binary tuning reuses exact parent blocks, including reduced fractions", () => {
  for (const [period, roots, expected] of [
    [1, [rational_angle(0, 1)], ["1/3", "2/3"]],
    [2, [rational_angle(2, 3), rational_angle(1, 3)], ["2/5", "3/5"]],
    [3, [rational_angle(3, 7), rational_angle(4, 7)], ["4/9", "5/9"]],
    [
      12,
      [rational_angle(66, 455), rational_angle(649, 4095)],
      ["2433673/16777215", "2658898/16777215"],
    ],
  ])
    assert.deepEqual(
      tuned_doubling_angles(roots, period).map((a) => a.key),
      expected,
    );
});
test("tuning rejects duplicate, incompatible, and lower-period parent angles", () => {
  for (const [period, roots] of [
    [4, [rational_angle(1, 3), rational_angle(2, 3)]],
    [3, [rational_angle(1, 7), rational_angle(1, 7)]],
    [3, [rational_angle(1, 5), rational_angle(2, 5)]],
    [1, [rational_angle(1, 3)]],
  ])
    assert.throws(
      () => tuned_doubling_angles(roots, period),
      /angles_unresolved/,
    );
});
test("reported period-12 minibrot tunes its verified root pair and traces beyond the old depth cap", () => {
  const tolerance = 0.00000833659;
  const result = find_minibrot_rays(
    { x: -0.007049415229, y: 0.806079498686 },
    12,
    { tolerance },
  );
  assert.equal(result.status, "complete");
  assert.equal(result.root_access.status, "complete");
  assert.equal(result.doubling.angle_source, "root_tuning");
  assert.deepEqual(result.rays.map((r) => r.angle.key).sort(), [
    "2433673/16777215",
    "2658898/16777215",
    "649/4095",
    "66/455",
  ]);
  for (const group of [result.doubling, result.root_access])
    for (const ray of group.rays)
      assert.ok(distance(ray.points.at(-1), group.root) < tolerance);
  for (const ray of result.doubling.rays)
    assert.ok(ray.points.length > 4096 * 4 + 1);
});

test("a larger depth budget does not reject a usable reference prefix", async () => {
  const { parameter_reference, perturbed_critical } =
    await import("../sdk/orbitals/FractoParameterRaySolver.js");
  const reference = parameter_reference({ x: 2, y: 0 }, 128);
  assert.equal(perturbed_critical({ x: 0, y: 0 }, 2, reference).z.x, 6);
  assert.throws(() => reference.ensure(128), /trace_reference/);
  assert.equal(perturbed_critical({ x: 0, y: 0 }, 2, reference).z.x, 6);
});

test("an allowed budget stop retains a nearby converged prefix without claiming landing", () => {
  const root = { x: -0.75, y: 0 },
    tolerance = 1e-7;
  const ray = trace_parameter_ray(rational_angle(1, 3), root, tolerance, {
    max_depth: 128,
    allow_partial: true,
    partial_radius: 0.375,
  });
  assert.equal(ray.status, "incomplete");
  assert.equal(ray.landed, false);
  assert.equal(ray.stop_reason, "trace_budget");
  assert.equal(ray.points.length, 128 * 4 + 1);
  assert.ok(ray.endpoint_error > tolerance);
  assert.ok(ray.endpoint_error < 0.375);
  assert.notDeepEqual(ray.points.at(-1), root);
  assert.ok(
    ray.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
  );
});
test("a failed Newton attempt is omitted while its reliable prefix remains drawable", () => {
  const ray = trace_parameter_ray(
    rational_angle(0, 1),
    { x: 0.3, y: 0 },
    1e-7,
    { max_depth: 128, allow_partial: true, partial_radius: 0.1 },
  );
  assert.equal(ray.status, "incomplete");
  assert.equal(ray.stop_reason, "trace_unresolved");
  assert.equal(ray.landed, false);
  assert.equal(
    ray.points.length,
    (ray.details.depth - 1) * 4 + ray.details.band_step + 1,
  );
  assert.ok(ray.endpoint_error > 1e-7);
  assert.ok(ray.points.at(-1).x < 0.3);
});
test("a failed or unrelated partner cannot erase a usable ray prefix", () => {
  const group = trace_parameter_ray_group(
    [rational_angle(1, 3), rational_angle(1, 7)],
    { x: -0.75, y: 0 },
    1e-7,
    { max_depth: 128, partial_radius: 0.375 },
  );
  assert.equal(group.status, "incomplete");
  assert.equal(group.rays.length, 1);
  assert.equal(group.rays[0].angle.key, "1/3");
  assert.equal(group.failures.length, 1);
  assert.equal(group.failures[0].angle.key, "1/7");
  assert.throws(
    () =>
      trace_parameter_ray(rational_angle(1, 7), { x: -0.75, y: 0 }, 1e-7, {
        max_depth: 128,
        allow_partial: true,
        partial_radius: 0.375,
      }),
    /trace_budget/,
  );
});
test("strict trace callers still require the target tolerance", () => {
  assert.throws(
    () =>
      trace_parameter_ray(rational_angle(1, 3), { x: -0.75, y: 0 }, 1e-7, {
        max_depth: 128,
      }),
    /trace_budget/,
  );
});
test("unconfirmed root prefixes never become tuning inputs", async () => {
  const { runInNewContext } = await import("node:vm");
  let supplied;
  const root = {
    status: "incomplete",
    rays: [{ landed: false, angle: rational_angle(1, 3) }],
  };
  const find = runInNewContext(`(${find_minibrot_rays.toString()})`, {
    find_component_root_rays: () => root,
    find_doubling_rays: (_c, _p, options) => {
      supplied = options.root_angles;
      return { status: "angles_unresolved", rays: [] };
    },
  });
  const result = find({ x: -1, y: 0 }, 2);
  assert.equal(result.status, "partial");
  assert.equal(result.rays.length, 1);
  assert.equal(supplied, undefined);
});

test("period-16 cusp confirmation stays inside the usable exterior probe band", () => {
  const tolerance = 0.000005015;
  const result = find_minibrot_rays(
    { x: 0.273428557437, y: 0.595445688613 },
    16,
    { tolerance },
  );
  assert.equal(result.status, "complete");
  assert.equal(result.root_access.status, "complete");
  assert.equal(result.doubling.status, "complete");
  assert.equal(result.doubling.angle_source, "root_tuning");
  assert.deepEqual(result.root_access.rays.map((ray) => ray.angle.key).sort(), [
    "171/1285",
    "8482/65535",
  ]);
  assert.deepEqual(result.doubling.rays.map((ray) => ray.angle.key).sort(), [
    "555885073/4294967295",
    "571547938/4294967295",
  ]);
  for (const group of [result.root_access, result.doubling])
    for (const ray of group.rays) {
      assert.equal(ray.landed, true);
      assert.ok(distance(ray.points.at(-1), group.root) < tolerance);
    }
});

test("default partial tracing retains paths far from the expected attachment", () => {
  const root = { x: -0.75, y: 0 };
  const ray = trace_parameter_ray(rational_angle(1, 7), root, 1e-7, {
    max_depth: 128,
    allow_partial: true,
  });
  assert.equal(ray.status, "incomplete");
  assert.equal(ray.landed, false);
  assert.ok(ray.endpoint_error > 0.375);
  assert.equal(ray.stop_reason, "trace_budget");
  const group = trace_parameter_ray_group(
    [rational_angle(1, 3), rational_angle(1, 7)],
    root,
    1e-7,
    { max_depth: 128 },
  );
  assert.equal(group.rays.length, 2);
  assert.equal(group.failures.length, 0);
  assert.equal(group.status, "incomplete");
});
test("a single accepted segment is enough to preserve an incomplete ray", () => {
  const ray = trace_parameter_ray(
    rational_angle(0, 1),
    { x: 0.25, y: 0 },
    1e-7,
    { max_depth: 1, sharpness: 1, allow_partial: true },
  );
  assert.equal(ray.points.length, 2);
  assert.equal(ray.landed, false);
  assert.equal(ray.status, "incomplete");
  assert.equal(ray.stop_reason, "trace_budget");
  assert.ok(
    ray.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
  );
});

test("period-17 primitive cusp retries its probe schedule and traces the characteristic pair", () => {
  const core = { x: -0.732796739121, y: 0.216291599911 };
  const result = find_minibrot_rays(core, 17, { tolerance: 1e-7 });
  assert.equal(result.root_access.status, "complete");
  assert.deepEqual(result.root_access.rays.map((ray) => ray.angle.key).sort(), [
    "43685/131071",
    "43686/131071",
  ]);
  for (const ray of result.root_access.rays) {
    assert.equal(ray.landed, true);
    assert.ok(ray.endpoint_error <= 1e-7);
  }
  assert.ok(result.doubling.rays.length > 0);
});
