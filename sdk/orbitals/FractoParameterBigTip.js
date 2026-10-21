import {
  parameter_math,
  parameter_digits,
} from "./FractoParameterPrecision.js";

export function big_refine_antenna_tip(guess, period) {
  const m = parameter_math(parameter_digits(period));
  const {
    D,
    point,
    sub,
    mul,
    add,
    scale,
    abs,
    div,
    finite,
    pack,
    critical,
    one,
  } = m;
  const epsilon = new D(10).pow(-(m.precision - 20));
  let c = point(guess);
  for (let k = 0; k < 80; k++) {
    const a = critical(c, 2 * period),
      b = critical(c, 3 * period);
    const step = div(sub(b.z, a.z), sub(b.d, a.d));
    if (!finite(step)) throw Error("tip_unresolved");
    c = sub(c, step);
    if (!finite(c)) throw Error("tip_unresolved");
    if (abs(step).lt(epsilon)) break;
  }
  const a = critical(c, 2 * period),
    b = critical(c, 3 * period);
  let z = a.z,
    multiplier = one;
  for (let k = 0; k < period; k++) {
    multiplier = scale(mul(z, multiplier), 2);
    z = add(mul(z, z), c);
  }
  if (
    !finite(b.z) ||
    !finite(multiplier) ||
    abs(sub(a.z, b.z)).gt(epsilon) ||
    abs(multiplier).lte("1.000001") ||
    abs(sub(critical(c, period).z, a.z)).lt(epsilon)
  )
    throw Error("tip_unresolved");
  return pack(c);
}
