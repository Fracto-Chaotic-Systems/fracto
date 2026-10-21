import { big_attachment_angles } from "./FractoParameterBigAngles.js";
/** Numerical characteristic-angle discovery; see PARAMETER_RAYS.md. */
import {
  add,
  sub,
  mul,
  scale,
  distance,
  rational_angle,
  divide as div,
} from "./FractoRayGeometry.js";
const ZERO = { x: 0, y: 0 },
  ONE = { x: 1, y: 0 };
// Follow the gradient of the parameter Green function outwards. Taking a
// principal logarithm of a small critical iterate can choose the wrong branch.
function flow(c, budget) {
  let z = ZERO,
    d = ZERO;
  for (let i = 0; i < 8192; i++) {
    if (--budget.remaining < 0) return null;
    d = add(scale(mul(z, d), 2), ONE);
    z = add(mul(z, z), c);
    const r = distance(z, ZERO);
    if (r > 1e12) return scale(div(z, d), Math.log(r));
  }
  return null;
}
function rk(c, h, budget) {
  const a = flow(c, budget);
  if (!a) return null;
  const b = flow(add(c, scale(a, h / 2)), budget);
  if (!b) return null;
  const d = flow(add(c, scale(b, h / 2)), budget);
  if (!d) return null;
  const e = flow(add(c, scale(d, h)), budget);
  if (!e) return null;
  return add(c, scale(add(add(a, scale(b, 2)), add(scale(d, 2), e)), h / 6));
}
function external_angle(c) {
  let h = 0.05;
  const budget = { remaining: 8000000 };
  for (let i = 0; i < 12000; i++) {
    if (distance(c, ZERO) > 1e8)
      return (((Math.atan2(c.y, c.x + 0.5) / (2 * Math.PI)) % 1) + 1) % 1;
    const full = rk(c, h, budget),
      mid = rk(c, h / 2, budget),
      half = mid && rk(mid, h / 2, budget);
    if (!full || !half) return null;
    const error = distance(full, half),
      allowed = Math.max(
        4e-15 * Math.max(1, distance(c, ZERO)),
        1e-13 * distance(c, half),
      );
    if (error > allowed) {
      h *= 0.5;
      if (h < 1e-8) return null;
      continue;
    }
    c = add(half, scale(sub(half, full), 1 / 15));
    if (error < allowed / 32) h = Math.min(0.1, h * 1.5);
  }
  return null;
}
function native_attachment_angles(
  attachment,
  n,
  { angle_period = 2 * n, cusp = false, probe_scale = 0.5, shrink = 0.5 } = {},
) {
  const denominator = (1n << BigInt(angle_period)) - 1n,
    D = Number(denominator),
    result = [];
  for (const sign of [-1, 1]) {
    let epsilon = distance(attachment.center, attachment.root) * probe_scale,
      previous = null,
      found = null;
    for (let k = 0; k < (n > 20 ? 48 : 16); k++, epsilon *= shrink) {
      const radius = distance(attachment.center, attachment.root);
      const probe = cusp
        ? add(
            add(attachment.root, scale(attachment.outward, epsilon)),
            scale(
              attachment.tangent,
              sign * 0.5 * epsilon * Math.sqrt(epsilon / radius),
            ),
          )
        : add(attachment.root, scale(attachment.tangent, epsilon * sign));
      const angle = external_angle(probe);
      if (angle === null) continue;
      const m = BigInt(Math.round(angle * D));
      if (m === previous && Math.abs(angle * D - Number(m)) < 0.03) {
        found = rational_angle(m, denominator);
        break;
      }
      previous = m;
    }
    if (!found) throw Error("angles_unresolved");
    result.push(found);
  }
  if (result[0].key === result[1].key) throw Error("angles_unresolved");
  return result;
}

export function attachment_angles(attachment, n, options = {}) {
  const angle_period = options.angle_period ?? 2 * n;
  // Native discovery has ample angular resolution through 32 bits; final
  // inward endpoint checks still validate its candidates. Failed native
  // reconstruction switches to Decimal for precise attachments or P > 20;
  // native P <= 20 failures are returned to the caller for probe retries.
  if (angle_period <= 32) {
    try {
      return native_attachment_angles(attachment, n, options);
    } catch (error) {
      if (n <= 20 && !attachment.precision) throw error;
    }
  }
  return big_attachment_angles(attachment, n, options);
}
