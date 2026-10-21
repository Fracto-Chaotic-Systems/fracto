import { big_component_attachment } from "./FractoParameterBigAttachment.js";
/** Critical-center refinement and multiplier continuation; see PARAMETER_RAYS.md. */
import {
  add,
  sub,
  mul,
  scale,
  distance,
  finite,
  divide as div,
} from "./FractoRayGeometry.js";
const ZERO = { x: 0, y: 0 },
  ONE = { x: 1, y: 0 };
export function critical(c, n) {
  let z = ZERO,
    d = ZERO;
  for (let i = 0; i < n; i++) {
    d = add(scale(mul(z, d), 2), ONE);
    z = add(mul(z, z), c);
    if (!finite(z)) break;
  }
  return { z, d };
}
function orbit(c, z, n) {
  let a = ONE,
    b = ZERO,
    aa = ZERO,
    ab = ZERO;
  const start = z;
  for (let i = 0; i < n; i++) {
    aa = scale(add(mul(a, a), mul(z, aa)), 2);
    ab = scale(add(mul(b, a), mul(z, ab)), 2);
    a = scale(mul(z, a), 2);
    b = add(scale(mul(z, b), 2), ONE);
    z = add(mul(z, z), c);
  }
  return { f: sub(z, start), a, b, aa, ab };
}
export function component_attachment(guess, n, rotation = -1) {
  if (
    n > 20 ||
    guess.exact ||
    typeof guess.x === "string" ||
    typeof guess.y === "string"
  )
    return big_component_attachment(guess, n, rotation);
  const multiplier =
    typeof rotation === "number" ? { x: rotation, y: 0 } : rotation;
  if (!finite(multiplier) || Math.abs(distance(multiplier, ZERO) - 1) > 1e-12)
    throw Error("attachment_unresolved");
  const is_root = multiplier.x === 1 && multiplier.y === 0;
  const boundary_target = is_root ? scale(multiplier, 1 - 1e-6) : multiplier;
  let c = { ...guess };
  for (let i = 0; i < 40; i++) {
    const { z, d } = critical(c, n),
      step = div(z, d);
    c = sub(c, step);
    if (!finite(c)) throw Error("core_unresolved");
    if (Math.hypot(step.x, step.y) < 1e-14) break;
  }
  if (distance(critical(c, n).z, ZERO) > 1e-9) throw Error("core_unresolved");
  for (let p = 1; p < n; p++)
    if (n % p === 0 && distance(critical(c, p).z, ZERO) < 1e-8)
      throw Error("period_mismatch");
  const center = c;
  let z = ZERO;
  const boundary_samples = [];
  for (let j = 1; j <= 64; j++) {
    const target = scale(boundary_target, j / 64);
    for (let i = 0; i < 30; i++) {
      const q = orbit(c, z, n),
        g = sub(q.a, target),
        det = sub(mul(sub(q.a, ONE), q.ab), mul(q.b, q.aa));
      const dz = div(sub(mul(q.f, q.ab), mul(q.b, g)), det),
        dc = div(sub(mul(sub(q.a, ONE), g), mul(q.aa, q.f)), det);
      z = sub(z, dz);
      c = sub(c, dc);
      if (!finite(c) || !finite(z)) throw Error("attachment_unresolved");
      if (Math.max(distance(dz, ZERO), distance(dc, ZERO)) < 1e-14) break;
    }
    if (is_root && j >= 62 && j <= 63)
      boundary_samples.push({ c: { ...c }, delta: 1 - target.x });
    const check = orbit(c, z, n);
    if (
      !finite(check.f) ||
      !finite(check.a) ||
      distance(check.f, ZERO) > 1e-9 ||
      distance(check.a, target) > 1e-8
    )
      throw Error("attachment_unresolved");
  }
  const q = orbit(c, z, n);
  if (
    !finite(q.f) ||
    !finite(q.a) ||
    distance(q.f, ZERO) > 1e-9 ||
    distance(q.a, boundary_target) > 1e-8
  )
    throw Error("attachment_unresolved");
  const det = sub(mul(sub(q.a, ONE), q.ab), mul(q.b, q.aa));
  const dc = div(sub(q.a, ONE), det);
  let outward = typeof rotation === "number" ? dc : mul(dc, multiplier);
  let cusp = false;
  if (is_root) {
    const [first, second] = boundary_samples;
    cusp = distance(c, second.c) / distance(c, first.c) < 0.35;
    if (cusp) {
      // dc/dlambda vanishes at a primitive cusp. Extrapolate the quadratic
      // approach direction from interior samples before roundoff dominates.
      const v1 = scale(sub(c, first.c), 1 / (first.delta * first.delta));
      const v2 = scale(sub(c, second.c), 1 / (second.delta * second.delta));
      outward = scale(
        sub(scale(v2, first.delta), scale(v1, second.delta)),
        1 / (first.delta - second.delta),
      );
    }
  }
  const len = distance(outward, ZERO);
  return {
    center,
    root: n === 1 && is_root ? { x: 0.25, y: 0 } : c,
    tangent: { x: -outward.y / len, y: outward.x / len },
    outward: { x: outward.x / len, y: outward.y / len },
    cusp,
  };
}

export const doubling_attachment = (guess, n) =>
  component_attachment(guess, n, -1);
