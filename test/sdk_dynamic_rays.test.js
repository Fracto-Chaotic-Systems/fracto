import {
  enumerate_doubling_families,
  doubling_family_count,
} from "../sdk/orbitals/FractoRayFamilies.js";
import { newton_big_complex } from "../sdk/orbitals/FractoNewtonBigComplex.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  rational_angle,
  doubled_angle,
  distance,
  sqrt,
  sub,
  scale,
} from "../sdk/orbitals/FractoRayGeometry.js";
import {
  assess_ray_orbital,
  connectedness_evidence,
} from "../sdk/orbitals/FractoRayEligibility.js";
import { trace_dynamic_ray } from "../sdk/orbitals/FractoDynamicRayTrace.js";
import { find_dynamic_rays } from "../sdk/orbitals/FractoDynamicRays.js";

// Analytic examples and orbit portraits: Milnor, Astérisque 261 (2000), §2/Appendix A.
// https://numdam.org/item/AST_2000__261__277_0/
test("rational angles transport exactly and wrap", () => {
  assert.equal(rational_angle(-1, 3).key, "2/3");
  assert.equal(doubled_angle(rational_angle(1, 7), 3).key, "1/7");
  assert.equal(doubled_angle(rational_angle(1, 3), 1000).key, "1/3");
});
test("z squared rays are radial and stop without a fabricated landing segment", () => {
  const ray = trace_dynamic_ray({ x: 0, y: 0 }, rational_angle(1, 7), {
    minimum_potential: 2 ** -40,
    verify_precision: true,
  });
  assert.equal(ray.reason, "potential_limit");
  for (const point of ray.points) {
    assert.ok(
      Math.abs(Math.atan2(point.y, point.x) - (2 * Math.PI) / 7) < 1e-12,
    );
    assert.ok(
      Math.abs(Math.hypot(point.x, point.y) - Math.exp(point.potential)) < 1e-9,
    );
  }
});
test("nontracing conditions are distinguished from failure to find angles", () => {
  assert.equal(assess_ray_orbital({ x: 0, y: 0 }, null).status, "no_selection");
  assert.equal(
    assess_ray_orbital({ x: 0, y: 0 }, { points: [{ x: 0, y: 0 }] }).status,
    "attracting",
  );
  assert.equal(
    assess_ray_orbital({ x: 0.25, y: 0 }, { points: [{ x: 0.5, y: 0 }] })
      .status,
    "neutral",
  );
  assert.equal(connectedness_evidence({ x: 1, y: 0 }).status, "disconnected");
  assert.equal(
    connectedness_evidence({ x: -2, y: 0 }, 128).status,
    "unresolved",
  );
  assert.equal(
    assess_ray_orbital({ x: 0, y: 0 }, { points: [{ x: NaN, y: 0 }] }).status,
    "invalid_orbital",
  );
});
test("closed repeated traversals reduce to their primitive period", () => {
  const result = assess_ray_orbital(
    { x: 0, y: 0 },
    {
      points: [
        { x: 1, y: 0 },
        { x: 1, y: 0 },
      ],
    },
  );
  assert.equal(result.status, "ready");
  assert.equal(result.period, 1);
});
test("disconnected Julia sets are rejected even for repelling closed orbitals", () => {
  const result = assess_ray_orbital(
    { x: 1, y: 0 },
    { points: [{ x: 0.5, y: Math.sqrt(3) / 2 }] },
  );
  assert.equal(result.status, "disconnected");
});
test("bounded search recovers the real basilica separating rays", async () => {
  const target = { x: (1 - Math.sqrt(5)) / 2, y: 0 };
  const result = await find_dynamic_rays({ x: -1, y: 0 }, { points: [target] });
  assert.equal(result.status, "rays_found");
  assert.deepEqual(result.rays.map((ray) => ray.angle.key).sort(), [
    "1/3",
    "2/3",
  ]);
  assert.equal(result.search.complete, false);
  for (const ray of result.rays) {
    assert.ok(distance(ray.endpoint, target) < 1e-6);
    assert.ok(ray.precision_error < 1e-6);
  }
});
test("angle doubling follows an actual period-three orbit", async () => {
  const points = [1, 2, 4].map((n) => ({
    x: Math.cos((2 * Math.PI * n) / 7),
    y: Math.sin((2 * Math.PI * n) / 7),
  }));
  const result = await find_dynamic_rays({ x: 0, y: 0 }, { points });
  assert.equal(result.period, 3);
  assert.deepEqual(result.rays.map((ray) => ray.angle.key).sort(), [
    "1/7",
    "2/7",
    "4/7",
  ]);
  for (const ray of result.rays)
    assert.ok(distance(ray.endpoint, result.points[ray.point_index]) < 1e-6);
});
test("multiple ray accesses at a rabbit fixed point survive slow landing", async () => {
  const c = { x: -0.1225611668766536, y: 0.7448617666197442 };
  const point = scale(
    sub({ x: 1, y: 0 }, sqrt({ x: 1 - 4 * c.x, y: -4 * c.y })),
    0.5,
  );
  const result = await find_dynamic_rays(c, { points: [point] });
  assert.equal(result.status, "rays_found");
  assert.deepEqual(result.rays.map((ray) => ray.angle.key).sort(), [
    "1/7",
    "2/7",
    "4/7",
  ]);
});
test("search and individual traces obey cancellation", async () => {
  const result = await find_dynamic_rays(
    { x: 0, y: 0 },
    { points: [{ x: 1, y: 0 }] },
    { cancelled: () => true },
  );
  assert.equal(result.status, "cancelled");
  assert.equal(
    trace_dynamic_ray({ x: 0, y: 0 }, rational_angle(0, 1), {
      cancelled: () => true,
    }).reason,
    "cancelled",
  );
});

const seven_point_orbit = (numerator) => {
  const points = [];
  for (let index = 0; index < 7; index++) {
    points.push({
      x: Math.cos((2 * Math.PI * numerator) / 127),
      y: Math.sin((2 * Math.PI * numerator) / 127),
    });
    numerator = (2 * numerator) % 127;
  }
  return { points };
};

test("general enumeration finds the seven-angle cycle and aligns rotated orbital ordering", async () => {
  for (const start of [5, 10]) {
    const stages = [];
    const result = await find_dynamic_rays(
      { x: 0, y: 0 },
      seven_point_orbit(start),
      { on_progress: (progress) => stages.push(progress.stage) },
    );
    assert.equal(result.status, "rays_found");
    assert.equal(result.search.strategy, "doubling_families");
    assert.equal(result.search.evaluations, 0);
    assert.equal(result.search.candidates, 18);
    assert.deepEqual(
      result.rays.map((ray) => ray.angle.key).sort(),
      [
        "5/127",
        "10/127",
        "20/127",
        "40/127",
        "80/127",
        "33/127",
        "66/127",
      ].sort(),
    );
    assert.ok(
      stages.every(
        (stage) => stage === "classifying" || stage === "doubling_families",
      ),
    );
    for (const ray of result.rays)
      assert.ok(distance(ray.endpoint, result.points[ray.point_index]) < 1e-6);
  }
});

test("another seven-point orbit is found without a special registered family", async () => {
  const result = await find_dynamic_rays({ x: 0, y: 0 }, seven_point_orbit(1));
  assert.equal(result.status, "rays_found");
  assert.equal(result.rays.length, 7);
  assert.equal(result.search.evaluations, 0);
  assert.equal(result.search.candidates, 18);
});

test("doubling-family validation remains cancellable", async () => {
  let stopped = false;
  const result = await find_dynamic_rays({ x: 0, y: 0 }, seven_point_orbit(5), {
    cancelled: () => stopped,
    on_progress: (progress) => {
      if (progress.stage === "doubling_families") stopped = true;
    },
  });
  assert.equal(result.status, "cancelled");
  assert.deepEqual(result.rays, []);
});

test("enumerated families are revalidated at a different focal parameter", async () => {
  const c = { x: 0.1, y: 0.1 };
  const seed = seven_point_orbit(5).points[0];
  const refined = newton_big_complex(c, 100, 7, {
    seed,
    precision_digits: 128,
  });
  assert.equal(refined.closure_reached, true);
  const result = await find_dynamic_rays(c, {
    points: refined.point_list.map((point) => ({
      x: Number(point.re),
      y: Number(point.im),
    })),
  });
  assert.equal(result.status, "rays_found");
  assert.equal(result.rays.length, 7);
  assert.equal(result.search.evaluations, 0);
  for (const ray of result.rays) assert.ok(ray.landing_error < 1e-6);
});

test("period-five families partition fractions without duplication", () => {
  const families = [...enumerate_doubling_families(5)];
  assert.equal(families.length, 6);
  assert.deepEqual(
    families[0].angles.map((a) => a.key),
    ["1/31", "2/31", "4/31", "8/31", "16/31"],
  );
  assert.deepEqual(
    families[1].angles.map((a) => a.key),
    ["3/31", "6/31", "12/31", "24/31", "17/31"],
  );
  const keys = families.flatMap((f) => f.angles.map((a) => a.key));
  assert.equal(new Set(keys).size, 30);
});

test("composite periods exclude shorter cycles and counts agree", () => {
  for (let period = 1; period <= 9; period++) {
    const families = [...enumerate_doubling_families(period)];
    assert.equal(families.length, doubling_family_count(period));
    assert.ok(families.every((f) => f.angles.length === period));
    const keys = families.flatMap((f) => f.angles.map((a) => a.key));
    assert.equal(new Set(keys).size, keys.length);
  }
  assert.equal(doubling_family_count(6), 9);
});

test("a different five-point cycle is discovered by arithmetic enumeration", async () => {
  let numerator = 3;
  const points = [];
  for (let i = 0; i < 5; i++) {
    points.push({
      x: Math.cos((2 * Math.PI * numerator) / 31),
      y: Math.sin((2 * Math.PI * numerator) / 31),
    });
    numerator = (2 * numerator) % 31;
  }
  const result = await find_dynamic_rays({ x: 0, y: 0 }, { points });
  assert.equal(result.status, "rays_found");
  assert.equal(result.search.candidates, 6);
  assert.deepEqual(
    result.rays.map((r) => r.angle.key).sort(),
    ["3/31", "6/31", "12/31", "24/31", "17/31"].sort(),
  );
});

test("a family budget reports incomplete work without broad fallback", async () => {
  const result = await find_dynamic_rays({ x: 0, y: 0 }, seven_point_orbit(5), {
    max_families: 1,
  });
  assert.equal(result.status, "family_limit");
  assert.equal(result.rays.length, 0);
  assert.equal(result.search.budget_reached, true);
  assert.equal(result.search.evaluations, 0);
});
