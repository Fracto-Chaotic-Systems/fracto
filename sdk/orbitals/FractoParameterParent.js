/** Detect satellite ancestry from its parabolic root; Milnor (2000), §§6,8. */
import {
  parameter_math,
  parameter_digits,
} from "./FractoParameterPrecision.js";
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
export function satellite_parent(root, n) {
  const m = parameter_math(parameter_digits(n));
  const { D, point, zero, one, add, sub, mul, scale, abs, div, finite, pack } =
    m;
  const c = point(root);
  for (let p = Math.floor(n / 2); p >= 1; p--) {
    if (n % p) continue;
    const orbit = (start) => {
      let z = start,
        a = one,
        b = zero,
        aa = zero,
        ab = zero;
      for (let k = 0; k < p; k++) {
        aa = scale(add(mul(a, a), mul(z, aa)), 2);
        ab = scale(add(mul(b, a), mul(z, ab)), 2);
        a = scale(mul(z, a), 2);
        b = add(scale(mul(z, b), 2), one);
        z = add(mul(z, z), c_current);
      }
      return { f: sub(z, start), a, b, aa, ab };
    };
    let c_current = c,
      z = zero;
    for (let k = 0; k < 120; k++) {
      const q = orbit(z),
        step = div(q.f, sub(q.a, one));
      if (!finite(step)) break;
      z = sub(z, step);
      if (abs(step).lt("1e-50")) break;
    }
    const q = orbit(z),
      count = n / p;
    if (
      !finite(q.a) ||
      !finite(q.f) ||
      abs(q.f).gt("1e-35") ||
      abs(q.a).minus(1).abs().gt("1e-16")
    )
      continue;
    let angle = D.atan2(q.a.y, q.a.x).div(D.acos(-1).mul(2));
    if (angle.lt(0)) angle = angle.plus(1);
    const numerator = angle.mul(count).round().toNumber();
    if (
      numerator <= 0 ||
      numerator >= count ||
      gcd(numerator, count) !== 1 ||
      angle.mul(count).minus(numerator).abs().gt("1e-14")
    )
      continue;
    let failed = false;
    for (let j = 63; j >= 0; j--) {
      const target = scale(q.a, new D(j).div(64));
      for (let k = 0; k < 80; k++) {
        const r = orbit(z),
          g = sub(r.a, target),
          det = sub(mul(sub(r.a, one), r.ab), mul(r.b, r.aa));
        const dz = div(sub(mul(r.f, r.ab), mul(r.b, g)), det);
        const dc = div(sub(mul(sub(r.a, one), g), mul(r.aa, r.f)), det);
        if (!finite(dz) || !finite(dc)) {
          failed = true;
          break;
        }
        z = sub(z, dz);
        c_current = sub(c_current, dc);
        if (abs(dz).lt("1e-50") && abs(dc).lt("1e-50")) break;
      }
      const r = orbit(z);
      if (failed || abs(r.f).gt("1e-35") || abs(sub(r.a, target)).gt("1e-35")) {
        failed = true;
        break;
      }
    }
    if (!failed)
      return {
        core: pack(c_current),
        period: p,
        numerator,
        denominator: count,
      };
  }
  return null;
}

/** Mechanical rotation word: its closest cyclic binary pair bounds the limb. */
export function rotation_words(p, q) {
  let word = "";
  for (let k = 0; k < q; k++)
    word += Math.floor(((k + 1) * p) / q) - Math.floor((k * p) / q);
  const rotations = [
    ...new Set(
      Array.from({ length: q }, (_, k) => word.slice(k) + word.slice(0, k)),
    ),
  ];
  rotations.sort();
  let pair = null,
    gap = null;
  for (let k = 1; k < rotations.length; k++) {
    const d = BigInt(`0b${rotations[k]}`) - BigInt(`0b${rotations[k - 1]}`);
    if (gap === null || d < gap) {
      gap = d;
      pair = [rotations[k - 1], rotations[k]];
    }
  }
  if (!pair) throw Error("angles_unresolved");
  return pair;
}
