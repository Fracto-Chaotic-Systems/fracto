/** Decimal exterior gradient integration and exact numerator reconstruction. */
import {
  parameter_math,
  parameter_digits,
} from "./FractoParameterPrecision.js";
import { rational_angle } from "./FractoRayGeometry.js";

export function big_attachment_angles(
  attachment,
  n,
  { angle_period = 2 * n, cusp = false, probe_scale = 0.5, shrink = 0.5 } = {},
) {
  const deadline = Date.now() + 120000;
  const m = parameter_math(
    Math.max(attachment.precision || 0, parameter_digits(angle_period)),
  );
  const { D, point, zero, one, add, sub, mul, scale, abs, div, finite } = m;
  const denominator = (1n << BigInt(angle_period)) - 1n,
    den = new D(denominator.toString());
  const angular_accuracy = D.min("1e-14", new D("0.0001").div(den));
  const root = point(attachment.root),
    center = point(attachment.center);
  const radius = abs(sub(root, center));
  const outer = D.max("1e8", den.sqrt().mul(100));
  const two_pi = D.acos(-1).mul(2);
  const flow = (c, budget) => {
    let z = zero,
      d = zero;
    for (let k = 0; k < Math.max(8192, 256 * n); k++) {
      if (--budget.remaining < 0) return null;
      if (budget.remaining % 1024 === 0 && Date.now() > deadline)
        throw Error("calculation_budget");
      d = add(scale(mul(z, d), 2), one);
      z = add(mul(z, z), c);
      const r_squared = z.x.mul(z.x).plus(z.y.mul(z.y));
      if (!finite(z)) return null;
      if (r_squared.gt("1e24")) return scale(div(z, d), r_squared.ln().div(2));
    }
    return null;
  };
  // Modified-midpoint extrapolation uses even powers of substep size.
  // A higher order avoids thousands of tiny RK4 steps at Decimal precision.
  const counts = [2, 4, 6, 8, 10, 12];
  const extrapolate = (c, h, budget) => {
    const rows = [];
    for (let level = 0; level < counts.length; level++) {
      const count = counts[level],
        step = h.div(count);
      const first = flow(c, budget);
      if (!first) return null;
      let previous = c,
        current = add(c, scale(first, step));
      for (let j = 1; j < count; j++) {
        const f = flow(current, budget);
        if (!f) return null;
        const next = add(previous, scale(f, step.mul(2)));
        previous = current;
        current = next;
      }
      const last = flow(current, budget);
      if (!last) return null;
      const row = [scale(add(add(previous, current), scale(last, step)), 0.5)];
      for (let j = 1; j <= level; j++) {
        const factor = new D(count)
          .div(counts[level - j])
          .pow(2)
          .minus(1);
        row.push(
          add(
            row[j - 1],
            scale(
              sub(row[j - 1], rows[level - 1][j - 1]),
              new D(1).div(factor),
            ),
          ),
        );
      }
      rows.push(row);
    }
    return {
      next: rows.at(-1).at(-1),
      error: abs(sub(rows.at(-1).at(-1), rows.at(-2).at(-1))),
    };
  };
  const external_angle = (initial) => {
    let c = initial,
      h = new D("0.25");
    const budget = { remaining: 12000000 };
    for (let k = 0; k < 48000; k++) {
      if (abs(c).gt(outer)) {
        let angle = D.atan2(c.y, c.x.plus(0.5)).div(two_pi);
        if (angle.lt(0)) angle = angle.plus(1);
        return angle;
      }
      const trial = extrapolate(c, h, budget);
      if (!trial) return null;
      const error = trial.error;
      const allowed = D.max(radius, abs(sub(c, root))).mul(angular_accuracy);
      if (error.gt(allowed)) {
        h = h.div(2);
        if (h.lt("1e-12")) return null;
        continue;
      }
      c = trial.next;
      if (error.lt(allowed.div(32))) h = D.min("1", h.mul(1.5));
    }
    return null;
  };
  const result = [];
  for (const sign of [-1, 1]) {
    let epsilon = radius.mul(probe_scale),
      previous = null,
      found = null;
    for (let k = 0; k < 48; k++, epsilon = epsilon.mul(shrink)) {
      const probe = cusp
        ? add(
            add(root, scale(point(attachment.outward), epsilon)),
            scale(
              point(attachment.tangent),
              epsilon
                .div(radius)
                .sqrt()
                .mul(epsilon)
                .mul(sign * 0.5),
            ),
          )
        : add(root, scale(point(attachment.tangent), epsilon.mul(sign)));
      const angle = external_angle(probe);
      if (angle === null) continue;
      const scaled = angle.mul(den),
        rounded = scaled.round(),
        key = rounded.toFixed(0);
      if (key === previous && scaled.minus(rounded).abs().lt("0.03")) {
        found = rational_angle(key, denominator);
        break;
      }
      previous = key;
    }
    if (!found) throw Error("angles_unresolved");
    result.push(found);
  }
  if (result[0].key === result[1].key) throw Error("angles_unresolved");
  return result;
}
