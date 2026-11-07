import Decimal from "decimal.js";

const D = Decimal.clone({ precision: 768 });
export const ORBITAL_CALCULATION_VERSION = "orbital-discovery-v2";
export const ORBITAL_CLOSURE_TOLERANCE = "1e-24";
export const ORBITAL_IDENTITY_TOLERANCE = "1e-20";

/** Canonical decimal spelling without converting high-precision coordinates to Number. */
export const orbital_decimal = (value) => {
  const text = String(value);
  if (
    text.length > 768 ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)
  )
    throw new Error("invalid_coordinate");
  const decimal = new D(text);
  if (!decimal.isFinite() || decimal.abs().gt(16))
    throw new Error("invalid_coordinate");
  return decimal.isZero() ? "0" : decimal.toString();
};

export const orbital_parameter = (point) => ({
  x: orbital_decimal(point?.x ?? point?.re),
  y: orbital_decimal(point?.y ?? point?.im),
});

const near = (a, b, tolerance) =>
  new D(a.re).minus(b.re).abs().lte(tolerance) &&
  new D(a.im).minus(b.im).abs().lte(tolerance);

/** Compare every point in forward dynamical order, allowing cyclic rotation only. */
export const same_orbital_cycle = (
  a,
  b,
  tolerance = ORBITAL_IDENTITY_TOLERANCE,
) =>
  a.length > 0 &&
  a.length === b.length &&
  b.some((_, shift) =>
    a.every((point, index) =>
      near(point, b[(index + shift) % b.length], tolerance),
    ),
  );

/** Recheck the complete cycle independently of a solver's convergence flag. */
export const orbital_closure_error = (parameter, points) => {
  let maximum = new D(0);
  const c = orbital_parameter(parameter);
  for (let i = 0; i < points.length; i++) {
    const z = points[i],
      next = points[(i + 1) % points.length];
    const x = new D(z.re),
      y = new D(z.im);
    const dx = x.mul(x).minus(y.mul(y)).plus(c.x).minus(next.re);
    const dy = x.mul(y).mul(2).plus(c.y).minus(next.im);
    maximum = D.max(maximum, dx.mul(dx).plus(dy.mul(dy)).sqrt());
  }
  return points.length ? maximum.toSignificantDigits(32).toString() : null;
};

/** Reduce proper divisors, preserve decimal coordinates, and choose a stable start. */
export const canonical_orbital = (
  parameter,
  input,
  precision_digits = 64,
  options = {},
) => {
  const closure_tolerance =
    options.closure_tolerance ?? ORBITAL_CLOSURE_TOLERANCE;
  if (!Array.isArray(input) || !input.length || input.length > 4096)
    return null;
  let points = input.map((p) => ({
    re: orbital_decimal(p.re ?? p.x),
    im: orbital_decimal(p.im ?? p.y),
  }));
  for (let p = 1; options.reduce_period !== false && p < points.length; p++) {
    if (
      points.length % p === 0 &&
      points.every((z, i) => near(z, points[i % p], ORBITAL_CLOSURE_TOLERANCE))
    ) {
      points = points.slice(0, p);
      break;
    }
  }
  const closure_error = orbital_closure_error(parameter, points);
  if (new D(closure_error).gt(closure_tolerance)) return null;
  let start = 0;
  for (let i = 1; i < points.length; i++) {
    const order =
      new D(points[i].re).cmp(points[start].re) ||
      new D(points[i].im).cmp(points[start].im);
    if (order < 0) start = i;
  }
  points = points.slice(start).concat(points.slice(0, start));
  return {
    points,
    period: points.length,
    precision_digits,
    closure_error,
    closure_tolerance,
    identity_tolerance:
      options.identity_tolerance ?? ORBITAL_IDENTITY_TOLERANCE,
    calculation_version: ORBITAL_CALCULATION_VERSION,
  };
};
