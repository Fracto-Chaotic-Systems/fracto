import { parameter_math } from "./FractoParameterPrecision.js";
import Decimal from "decimal.js";
const references = new Map();
/** High-precision reference orbit with native perturbation steps; see PARAMETER_RAYS.md. */
export function parameter_reference(root, max_depth) {
  const key = `${root.exact?.x ?? root.x}:${root.exact?.y ?? root.y}:${root.precision || 64}:${max_depth}`;
  if (references.has(key)) return references.get(key);
  const D = Decimal.clone({ precision: root.precision || 64 });
  const cr = new D(root.exact?.x ?? root.x),
    ci = new D(root.exact?.y ?? root.y);
  const x = new Float64Array(max_depth + 1),
    y = new Float64Array(max_depth + 1);
  let zr = new D(0),
    zi = new D(0);
  let computed_depth = 0,
    failed = false;
  const ensure = (depth) => {
    if (depth > max_depth || (failed && depth > computed_depth))
      throw Error("trace_reference");
    for (let k = computed_depth + 1; k <= depth; k++) {
      const next = zr.mul(zr).minus(zi.mul(zi)).plus(cr);
      zi = zr.mul(zi).mul(2).plus(ci);
      zr = next;
      x[k] = zr.toNumber();
      y[k] = zi.toNumber();
      if (!Number.isFinite(x[k]) || !Number.isFinite(y[k])) {
        failed = true;
        throw Error("trace_reference");
      }
      computed_depth = k;
    }
  };
  const reference = { root, x, y, ensure };
  if (references.size >= 4) references.delete(references.keys().next().value);
  references.set(key, reference);
  return reference;
}
// z=Z+dz: dz_next=2*Z*dz+dz^2+delta_c. Keep delta_c separate
// from the full parameter so sub-ulp Newton corrections remain representable.
export function perturbed_critical(delta, n, reference) {
  reference.ensure(n);
  let x = 0,
    y = 0,
    dx = 0,
    dy = 0;
  for (let k = 0; k < n; k++) {
    const rx = reference.x[k],
      ry = reference.y[k],
      zx = rx + x,
      zy = ry + y;
    const next_dx = 2 * (zx * dx - zy * dy) + 1;
    dy = 2 * (zx * dy + zy * dx);
    dx = next_dx;
    const next_x = 2 * (rx * x - ry * y) + x * x - y * y + delta.x;
    y = 2 * (rx * y + ry * x + x * y) + delta.y;
    x = next_x;
    if (!Number.isFinite(x) || !Number.isFinite(y)) break;
  }
  return {
    z: { x: reference.x[n] + x, y: reference.y[n] + y },
    d: { x: dx, y: dy },
  };
}

/** Retry one failed sample with Decimal arithmetic, retaining an exact delta. */
export function decimal_parameter_sample(delta, depth, reference, target) {
  const m = parameter_math(Math.max(80, reference.root.precision || 0));
  const root = m.point(reference.root),
    t = m.point(target);
  let offset = m.point(delta);
  for (let k = 0; k < 60; k++) {
    const q = m.critical(m.add(root, offset), depth);
    const residual = m.sub(q.z, t),
      step = m.div(residual, q.d);
    if (!m.finite(step)) return null;
    offset = m.sub(offset, step);
    if (m.abs(residual).lt(m.abs(t).mul("1e-12"))) {
      return { x: offset.x.toNumber(), y: offset.y.toNumber() };
    }
  }
  return null;
}
