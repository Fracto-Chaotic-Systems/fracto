/** Decimal continuation mirrors the native solver; see PARAMETER_PRECISION.md. */
import {
  parameter_math,
  parameter_digits,
} from "./FractoParameterPrecision.js";

export function big_component_attachment(guess, n, rotation = -1) {
  const m = parameter_math(parameter_digits(n));
  const {
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
  } = m;
  const epsilon = new D(10).pow(-(m.precision - 20));
  const norm = (p) => abs(p);
  const close = (p) => norm(p).lt(epsilon);
  let multiplier = point(
    typeof rotation === "number" ? { x: rotation, y: 0 } : rotation,
  );
  if (!finite(multiplier) || norm(multiplier).minus(1).abs().gt("1e-12"))
    throw Error("attachment_unresolved");
  // Recompute the supported thirds exactly, rather than importing rounded trig.
  if (typeof rotation !== "number" && Math.abs(rotation.x + 0.5) < 1e-12) {
    multiplier = {
      x: new D(-0.5),
      y: new D(3)
        .sqrt()
        .div(2)
        .mul(rotation.y < 0 ? -1 : 1),
    };
  }
  const is_root = multiplier.x.eq(1) && multiplier.y.eq(0);
  const target_boundary = is_root
    ? scale(
        multiplier,
        new D(1).minus(new D(10).pow(-Math.ceil(m.precision / 3))),
      )
    : multiplier;
  let c = point(guess);
  for (let k = 0; k < 80; k++) {
    const q = critical(c, n),
      step = div(q.z, q.d);
    c = sub(c, step);
    if (!finite(c)) throw Error("core_unresolved");
    if (close(step)) break;
  }
  if (!close(critical(c, n).z)) throw Error("core_unresolved");
  for (let p = 1; p < n; p++)
    if (n % p === 0 && close(critical(c, p).z)) throw Error("period_mismatch");
  const center = c;
  const orbit = (c, z) => {
    const start = z;
    let a = one,
      b = zero,
      aa = zero,
      ab = zero;
    for (let k = 0; k < n; k++) {
      aa = scale(add(mul(a, a), mul(z, aa)), 2);
      ab = scale(add(mul(b, a), mul(z, ab)), 2);
      a = scale(mul(z, a), 2);
      b = add(scale(mul(z, b), 2), one);
      z = add(mul(z, z), c);
    }
    return { f: sub(z, start), a, b, aa, ab };
  };
  let z = zero;
  const samples = [];
  for (let j = 1; j <= 64; j++) {
    const target = scale(target_boundary, new D(j).div(64));
    for (let k = 0; k < 160; k++) {
      const q = orbit(c, z),
        g = sub(q.a, target),
        det = sub(mul(sub(q.a, one), q.ab), mul(q.b, q.aa));
      const dz = div(sub(mul(q.f, q.ab), mul(q.b, g)), det);
      const dc = div(sub(mul(sub(q.a, one), g), mul(q.aa, q.f)), det);
      z = sub(z, dz);
      c = sub(c, dc);
      if (!finite(c) || !finite(z)) throw Error("attachment_unresolved");
      if (close(dz) && close(dc)) break;
    }
    const q = orbit(c, z);
    if (
      abs(q.f).gt(new D(10).pow(-Math.floor(m.precision / 2))) ||
      abs(sub(q.a, target)).gt(new D(10).pow(-Math.floor(m.precision / 2)))
    )
      throw Error("attachment_unresolved");
    if (is_root && j >= 62 && j <= 63)
      samples.push({ c, delta: new D(1).minus(target.x) });
  }
  const q = orbit(c, z),
    det = sub(mul(sub(q.a, one), q.ab), mul(q.b, q.aa));
  const dc = div(sub(q.a, one), det);
  let outward = typeof rotation === "number" ? dc : mul(dc, multiplier),
    cusp = false;
  if (is_root) {
    const [first, second] = samples;
    cusp = abs(sub(c, second.c))
      .div(abs(sub(c, first.c)))
      .lt(0.35);
    if (cusp) {
      const v1 = scale(sub(c, first.c), new D(1).div(first.delta.pow(2)));
      const v2 = scale(sub(c, second.c), new D(1).div(second.delta.pow(2)));
      outward = scale(
        sub(scale(v2, first.delta), scale(v1, second.delta)),
        new D(1).div(first.delta.minus(second.delta)),
      );
    }
  }
  const length = abs(outward),
    unit = scale(outward, new D(1).div(length));
  if (!finite(unit) || length.isZero()) throw Error("attachment_unresolved");
  return {
    center: pack(center),
    root: pack(n === 1 && is_root ? point({ x: 0.25, y: 0 }) : c),
    tangent: pack({ x: unit.y.neg(), y: unit.x }),
    outward: pack(unit),
    cusp,
    precision: m.precision,
  };
}
