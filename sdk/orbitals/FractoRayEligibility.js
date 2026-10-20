import BigComplex from "../math/BigComplex.js";
import { newton_big_complex } from "./FractoNewtonBigComplex.js";
import {
  finite,
  distance,
  mul,
  add,
  primitive_period,
} from "./FractoRayGeometry.js";

/** Periodic landing requires a repelling/parabolic target, not confidence.
 * Milnor, Astérisque 261 (2000), §2; Benini–Lyubich, AIF 64 (2014), §2.
 * https://numdam.org/item/AST_2000__261__277_0/
 * https://doi.org/10.5802/aif.2888
 */
export const connectedness_evidence = (c, limit = 2048) => {
  const root = new BigComplex(1 - 4 * c.x, -4 * c.y, 64).sqrt();
  const lambda = { x: 1 - Number(root.re), y: -Number(root.im) };
  if (Math.hypot(lambda.x, lambda.y) < 1 - 1e-10)
    return { status: "connected", method: "attracting_fixed_point" };
  if (Math.hypot(c.x + 1, c.y) < 0.25 - 1e-10)
    return { status: "connected", method: "period_two_disk" };
  let z = { x: 0, y: 0 };
  const bailout = Math.max(2, Math.hypot(c.x, c.y) + 1);
  for (let i = 0; i < limit; i++) {
    z = add(mul(z, z), c);
    if (!finite(z) || Math.hypot(z.x, z.y) > bailout)
      return { status: "disconnected", method: "critical_orbit_escape" };
  }
  // A return estimate only proposes a trap; it never establishes connectedness itself.
  let probe = z,
    period = 0;
  for (let p = 1; p <= 64; p++) {
    probe = add(mul(probe, probe), c);
    if (distance(probe, z) < 1e-9) {
      period = p;
      break;
    }
  }
  if (period) {
    const result = newton_big_complex(c, 80, period, {
      precision_digits: 128,
      seed: z,
    });
    if (result.closure_reached) {
      const points = result.point_list.map((p) => ({
        x: Number(p.re),
        y: Number(p.im),
      }));
      const index = points.reduce(
        (best, p, i) => (distance(p, z) < distance(points[best], z) ? i : best),
        0,
      );
      for (
        let radius = Math.max(1e-8, distance(points[index], z) * 2);
        radius <= 0.25;
        radius *= 4
      ) {
        let r = radius;
        for (let k = 0; k < points.length; k++) {
          const a = points[(index + k) % points.length],
            b = points[(index + k + 1) % points.length];
          r =
            2 * Math.hypot(a.x, a.y) * r +
            r * r +
            distance(add(mul(a, a), c), b) +
            1e-14;
        }
        if (r < radius * 0.99)
          return {
            status: "connected",
            method: "critical_orbit_trapping_disk",
          };
      }
    }
  }
  return { status: "unresolved", method: "bounded_critical_orbit_not_a_proof" };
};

export const assess_ray_orbital = (parameter, orbital) => {
  const c = { x: Number(parameter?.x), y: Number(parameter?.y) };
  if (!finite(c)) return { status: "invalid_input" };
  if (!orbital?.points?.length) return { status: "no_selection" };
  if (!orbital.points.every(finite) || orbital.points.length > 256)
    return { status: "invalid_orbital" };
  // Singular parabolic roots may be closed already while Newton cannot divide by H'.
  const original = orbital.points;
  const residual = Math.max(
    ...original.map((p, i) =>
      distance(add(mul(p, p), c), original[(i + 1) % original.length]),
    ),
  );
  const primitive = original.slice(0, primitive_period(original));
  const original_log = primitive.reduce(
    (sum, p) => sum + Math.log(2 * Math.hypot(p.x, p.y)),
    0,
  );
  if (residual <= 1e-12 && Math.abs(original_log) <= 1e-6)
    return { status: "neutral", period: primitive.length };
  const seed = orbital.points[0];
  let refined = null;
  // Preserve the supplied decimal parameter and the selected solution branch.
  for (const precision_digits of [64, 128, 256, 512]) {
    const result = newton_big_complex(parameter, 100, orbital.points.length, {
      seed,
      precision_digits,
    });
    if (!result.closure_reached || result.closure_error > 1e-24) continue;
    const points = result.point_list.map((p) => ({
      x: Number(p.re),
      y: Number(p.im),
    }));
    if (
      distance(points[0], seed) > 1e-5 &&
      !points.some((p) => distance(p, seed) < 1e-5)
    )
      return { status: "branch_changed" };
    refined = { points, precision_digits, closure_error: result.closure_error };
    break;
  }
  if (!refined) return { status: "closure_failed" };
  const period = primitive_period(refined.points),
    points = refined.points.slice(0, period);
  let log_modulus = 0,
    phase = 0;
  for (const p of points) {
    log_modulus += Math.log(2 * Math.hypot(p.x, p.y));
    phase += Math.atan2(p.y, p.x);
  }
  const multiplier = { modulus: Math.exp(log_modulus), log_modulus, phase };
  if (log_modulus < Math.log(1 - 1e-6))
    return { status: "attracting", period, multiplier, ...refined, points };
  if (!(log_modulus > Math.log(1 + 1e-6)))
    return { status: "neutral", period, multiplier, ...refined, points };
  const connectedness = connectedness_evidence(c);
  if (connectedness.status !== "connected")
    return {
      status: connectedness.status,
      period,
      multiplier,
      connectedness,
      ...refined,
      points,
    };
  return {
    status: "ready",
    period,
    multiplier,
    connectedness,
    ...refined,
    points,
  };
};
