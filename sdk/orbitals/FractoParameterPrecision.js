import Decimal from "decimal.js";

// Conservative tested ceiling; this is a work/precision policy, not mathematics.
export const MAX_PARAMETER_PERIOD = 32;
export const parameter_digits = (period) =>
  Math.max(80, 40 + Math.ceil(period * 0.7));
export function parameter_math(precision = 80) {
  const D = Decimal.clone({ precision });
  const point = (p) => ({
    x: new D(p.exact?.x ?? p.x),
    y: new D(p.exact?.y ?? p.y),
  });
  const zero = point({ x: 0, y: 0 }),
    one = point({ x: 1, y: 0 });
  const add = (a, b) => ({ x: a.x.plus(b.x), y: a.y.plus(b.y) });
  const sub = (a, b) => ({ x: a.x.minus(b.x), y: a.y.minus(b.y) });
  const mul = (a, b) => ({
    x: a.x.mul(b.x).minus(a.y.mul(b.y)),
    y: a.x.mul(b.y).plus(a.y.mul(b.x)),
  });
  const scale = (a, k) => ({ x: a.x.mul(k), y: a.y.mul(k) });
  const abs = (a) => a.x.mul(a.x).plus(a.y.mul(a.y)).sqrt();
  const div = (a, b) => {
    const q = b.x.mul(b.x).plus(b.y.mul(b.y));
    return {
      x: a.x.mul(b.x).plus(a.y.mul(b.y)).div(q),
      y: a.y.mul(b.x).minus(a.x.mul(b.y)).div(q),
    };
  };
  const finite = (a) => a.x.isFinite() && a.y.isFinite();
  const pack = (p) => ({
    x: p.x.toNumber(),
    y: p.y.toNumber(),
    exact: { x: p.x.toString(), y: p.y.toString() },
    precision,
  });
  const critical = (c, n) => {
    let z = zero,
      d = zero;
    for (let k = 0; k < n; k++) {
      d = add(scale(mul(z, d), 2), one);
      z = add(mul(z, z), c);
      if (!finite(z)) break;
    }
    return { z, d };
  };
  return {
    D,
    point,
    zero,
    one,
    add,
    sub,
    mul,
    scale,
    abs,
    div,
    finite,
    pack,
    critical,
    precision,
  };
}
export function parameter_distance(a, b) {
  if (!a.exact && !b.exact) return Math.hypot(a.x - b.x, a.y - b.y);
  const m = parameter_math(Math.max(a.precision || 64, b.precision || 64));
  return m.abs(m.sub(m.point(a), m.point(b))).toNumber();
}
const finite_coordinate = (value) =>
  (typeof value === "number" ||
    (typeof value === "string" && value.trim() !== "")) &&
  Number.isFinite(Number(value));
export const finite_parameter = (p) =>
  Boolean(
    p &&
    finite_coordinate(p.exact?.x ?? p.x) &&
    finite_coordinate(p.exact?.y ?? p.y),
  );
