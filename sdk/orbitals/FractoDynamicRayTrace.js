import BigComplex from "../math/BigComplex.js";
import {
  sub,
  mul,
  scale,
  sqrt,
  distance,
  finite,
  angle_at,
} from "./FractoRayGeometry.js";

/** Inverse Böttcher construction with radial continuation of square-root branches.
 * Milnor (2000), Appendix A; Benini–Lyubich, AIF 64 (2014), §2.
 * https://numdam.org/item/AST_2000__261__277_0/
 * https://doi.org/10.5802/aif.2888
 * This bounded numerical construction does not certify all possible accesses.
 */
const OUTER = 8;
const inverse_point = (c, angle, potential, previous) => {
  const depth = Math.max(0, Math.ceil(Math.log2(OUTER / potential)));
  const tail = potential * 2 ** depth,
    phase = angle_at(angle, depth),
    radius = Math.exp(tail);
  const w = { x: radius * Math.cos(phase), y: radius * Math.sin(phase) };
  // phi^-1(w) = w - c/(2w) + O(w^-3); the tail radius exceeds exp(8).
  const reciprocal = {
    x: w.x / (radius * radius),
    y: -w.y / (radius * radius),
  };
  const chain = [];
  chain[depth] = sub(w, scale(mul(c, reciprocal), 0.5));
  let jump = false;
  for (let level = depth - 1; level >= 0; level--) {
    const root = sqrt(sub(chain[level + 1], c));
    const reference = previous?.[level] || {
      x: Math.exp(potential * 2 ** level) * Math.cos(angle_at(angle, level)),
      y: Math.exp(potential * 2 ** level) * Math.sin(angle_at(angle, level)),
    };
    const negative = scale(root, -1);
    chain[level] =
      distance(root, reference) <= distance(negative, reference)
        ? root
        : negative;
    if (
      previous?.[level] &&
      distance(chain[level], reference) >
        Math.max(1e-12, Math.hypot(root.x, root.y) * 0.55)
    )
      jump = true;
  }
  return { chain, point: chain[0], jump };
};

export const trace_dynamic_ray = (c, angle, options = {}) => {
  const tolerance = options.tolerance ?? 0.001;
  const minimum = options.minimum_potential ?? 2 ** -80;
  const limit = options.max_points ?? 2500;
  let t = OUTER,
    previous = inverse_point(c, angle, t),
    step = 0.25;
  const points = [{ ...previous.point, potential: t }];
  let reason = "potential_limit",
    retries = 0;
  while (t > minimum && points.length < limit) {
    if (options.cancelled?.()) {
      reason = "cancelled";
      break;
    }
    const next = Math.max(minimum, t * Math.exp(-step));
    const mid = Math.sqrt(t * next);
    const direct = inverse_point(c, angle, next, previous.chain);
    const halfway = inverse_point(c, angle, mid, previous.chain);
    const refined = inverse_point(c, angle, next, halfway.chain);
    const near =
      Math.min(
        Math.hypot(previous.point.x, previous.point.y),
        Math.hypot(refined.point.x, refined.point.y),
      ) < 8;
    const deviation = distance(
      halfway.point,
      scale(
        {
          x: previous.point.x + refined.point.x,
          y: previous.point.y + refined.point.y,
        },
        0.5,
      ),
    );
    if (!finite(refined.point)) {
      reason = "nonfinite";
      break;
    }
    if (
      direct.jump ||
      halfway.jump ||
      refined.jump ||
      distance(direct.point, refined.point) > tolerance * 0.1 ||
      (near && deviation > tolerance)
    ) {
      step /= 2;
      retries++;
      if (step < 1e-7 || retries > 20000) {
        reason = "precision_limit";
        break;
      }
      continue;
    }
    points.push({ ...refined.point, potential: next });
    previous = refined;
    t = next;
    if (
      options.target &&
      distance(refined.point, options.target) <= tolerance * 0.25 &&
      points.length > 6
    ) {
      reason = "target_reached";
      break;
    }
    step = Math.min(0.3, step * 1.2);
  }
  if (points.length >= limit) reason = "point_limit";
  let precision_error = null;
  if (options.verify_precision && reason === "potential_limit") {
    // Re-evaluate the terminal inverse chain with exact rational phase and 128 digits.
    const depth = previous.chain.length - 1;
    const unit = new BigComplex(0, 0, 128),
      D = unit.Decimal;
    const transported =
      (BigInt(angle.numerator) * (1n << BigInt(depth))) %
      BigInt(angle.denominator);
    const phase = new D(String(transported))
      .div(angle.denominator)
      .mul(D.acos(-1))
      .mul(2);
    const radius = new D(t).mul(new D(2).pow(depth)).exp();
    const w = new BigComplex(
      radius.mul(phase.cos()),
      radius.mul(phase.sin()),
      128,
    );
    const parameter = new BigComplex(c.x, c.y, 128);
    let z = w.add(parameter.divide(w).scale(-0.5));
    for (let level = depth - 1; level >= 0; level--) {
      z = z.offset(-c.x, -c.y).sqrt();
      const value = { x: Number(z.re), y: Number(z.im) },
        negative = scale(value, -1);
      if (
        distance(negative, previous.chain[level]) <
        distance(value, previous.chain[level])
      )
        z = z.scale(-1);
    }
    const endpoint = { x: Number(z.re), y: Number(z.im), potential: t };
    precision_error = distance(endpoint, points.at(-1));
    if (!finite(endpoint) || precision_error > tolerance * 0.25)
      reason = "precision_limit";
    else points[points.length - 1] = endpoint;
  }
  return {
    angle,
    points,
    endpoint: points.at(-1),
    reason,
    potential: points.at(-1).potential,
    precision_error,
  };
};
