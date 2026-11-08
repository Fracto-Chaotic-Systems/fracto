import test from "node:test";
import assert from "node:assert/strict";
import { trace_known_dynamic_rays } from "../sdk/orbitals/FractoKnownDynamicRays.js";
import {
  rational_angle,
  scale,
  sub,
  sqrt,
} from "../sdk/orbitals/FractoRayGeometry.js";

const fixed = () => ({
  focal_point: { x: "0", y: "0" },
  period: 1,
  orbital_points: [{ re: "1", im: "0" }],
  requests: [
    {
      point_index: 0,
      landing_point: { re: "1", im: "0" },
      angle: rational_angle(0, 1),
    },
  ],
});

test("known unit-circle access traces directly, verifies landing, and publishes progress", async () => {
  const progress = [];
  const result = await trace_known_dynamic_rays(fixed(), {
    on_progress: (p) => progress.push(p),
  });
  assert.equal(result.status, "rays_found");
  assert.equal(result.rays.length, 1);
  assert.equal(result.rays[0].angle.key, "0/1");
  assert.ok(result.rays[0].landing_error <= 2.5e-7);
  assert.equal(result.rays[0].reason, "potential_limit");
  assert.ok(Number.isFinite(result.rays[0].precision_error));
  assert.equal(progress[0].processed, 0);
  assert.equal(progress.at(-1).processed, 1);
});

test("known period-two family validates both targets and rejects a swapped assignment", async () => {
  const points = [
    { re: "-0.5", im: String(Math.sqrt(3) / 2) },
    { re: "-0.5", im: String(-Math.sqrt(3) / 2) },
  ];
  const request = {
    focal_point: { x: "0", y: "0" },
    period: 2,
    orbital_points: points,
    requests: points.map((landing_point, point_index) => ({
      point_index,
      landing_point,
      angle: rational_angle(point_index + 1, 3),
    })),
  };
  const result = await trace_known_dynamic_rays(request);
  assert.equal(result.status, "rays_found");
  assert.deepEqual(
    result.rays.map((r) => r.point_index),
    [0, 1],
  );
  const wrong = await trace_known_dynamic_rays({
    ...request,
    requests: request.requests.map((r) => ({
      ...r,
      landing_point: points[1 - r.point_index],
    })),
  });
  assert.equal(wrong.status, "partial");
  assert.deepEqual(wrong.rays, []);
  assert.ok(wrong.unresolved.every((r) => r.reason === "landing_mismatch"));
});

test("missing angle partners are unresolved without searching for new accesses", async () => {
  const request = fixed();
  request.requests[0].angle = rational_angle(1, 3);
  const result = await trace_known_dynamic_rays(request);
  assert.equal(result.rays.length, 0);
  assert.equal(result.unresolved[0].reason, "incomplete_family");
});

test("multiple accesses to one rabbit landing point trace as one known family", async () => {
  const c = { x: -0.1225611668766536, y: 0.7448617666197442 };
  const point = scale(
    sub({ x: 1, y: 0 }, sqrt({ x: 1 - 4 * c.x, y: -4 * c.y })),
    0.5,
  );
  const landing_point = { re: String(point.x), im: String(point.y) };
  const result = await trace_known_dynamic_rays({
    focal_point: c,
    period: 1,
    orbital_points: [landing_point],
    requests: [1, 2, 4].map((n) => ({
      point_index: 0,
      landing_point,
      angle: rational_angle(n, 7),
    })),
  });
  assert.equal(result.status, "rays_found");
  assert.deepEqual(
    result.rays.map((r) => r.angle.key),
    ["1/7", "2/7", "4/7"],
  );
  assert.ok(
    result.rays.every((r) => r.point_index === 0 && r.landing_error <= 2.5e-7),
  );
});

test("point budgets, cancellation, and empty requests cannot report verified rays", async () => {
  const limited = await trace_known_dynamic_rays(fixed(), { max_points: 1 });
  assert.equal(limited.rays.length, 0);
  assert.equal(limited.status, "partial");
  assert.equal(
    (await trace_known_dynamic_rays(fixed(), { cancelled: () => true })).status,
    "cancelled",
  );
  assert.equal(
    (await trace_known_dynamic_rays({ requests: [] })).status,
    "no_ratios",
  );
});
