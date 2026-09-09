import Decimal from "decimal.js";

/** Default precision retained for existing callers. */
export const RESOLUTION_DIGITS = 64;

const decimal_contexts = new Map();

/**
 * Return a cached Decimal constructor configured for the requested precision.
 * Each context is independent, allowing concurrent calculations to use
 * different resolutions without changing global arithmetic settings.
 *
 * @param {number} precision Significant decimal digits.
 * @returns {typeof Decimal} Precision-specific Decimal constructor.
 */
const get_decimal_context = (precision) => {
  const normalized = Math.max(
    1,
    Math.floor(Number(precision) || RESOLUTION_DIGITS),
  );
  if (!decimal_contexts.has(normalized)) {
    decimal_contexts.set(
      normalized,
      Decimal.clone({
        precision: normalized,
        rounding: Decimal.ROUND_HALF_UP,
      }),
    );
  }
  return decimal_contexts.get(normalized);
};

/**
 * Arbitrary-precision complex number with an instance-local Decimal context.
 * Arithmetic between values of different precision is promoted to the higher
 * precision. The public `re` and `im` fields remain Decimal instances for
 * compatibility with existing callers.
 */
export class BigComplex {
  /**
   * @param {number|string|Decimal} re Real component.
   * @param {number|string|Decimal} im Imaginary component.
   * @param {number} resolution_digits Significant decimal digits.
   */
  constructor(re, im, resolution_digits = RESOLUTION_DIGITS) {
    this.precision = Math.max(
      1,
      Math.floor(Number(resolution_digits) || RESOLUTION_DIGITS),
    );
    this.Decimal = get_decimal_context(this.precision);
    this.re = new this.Decimal(re);
    this.im = new this.Decimal(im);
  }

  /** @param {BigComplex} value @returns {number} Common operand precision. */
  operation_precision = (value) =>
    Math.max(this.precision, value?.precision || this.precision);

  /** @param {BigComplex} value @param {number} precision @returns {BigComplex} Promoted value. */
  promote = (value, precision = this.precision) =>
    new BigComplex(value.re, value.im, precision);

  /** @param {number} digits Significant digits to return. @returns {number} Native real value. */
  get_re = (digits = 30) => this.re.toSignificantDigits(digits).toNumber();

  /** @param {number} digits Significant digits to return. @returns {number} Native imaginary value. */
  get_im = (digits = 30) => this.im.toSignificantDigits(digits).toNumber();

  /** @returns {boolean} Whether both components are finite. */
  is_valid = () => this.re.isFinite() && this.im.isFinite();

  /** @returns {Decimal} High-precision magnitude. */
  magnitude = () => this.re.mul(this.re).plus(this.im.mul(this.im)).sqrt();

  /** @returns {string} Full precision textual representation. */
  toString = () => `[${this.re.toString()}, ${this.im.toString()}]`;

  /** @param {BigComplex} value @returns {boolean} Exact component equality. */
  compare = (value) => this.re.eq(value.re) && this.im.eq(value.im);

  /** @param {BigComplex} value @returns {BigComplex} Complex product. */
  mul = (value) => {
    const precision = this.operation_precision(value);
    const left = this.promote(this, precision);
    const right = this.promote(value, precision);
    return new BigComplex(
      left.re.mul(right.re).minus(left.im.mul(right.im)),
      left.re.mul(right.im).plus(left.im.mul(right.re)),
      precision,
    );
  };

  /** @param {BigComplex} value @returns {BigComplex} In-place Mandelbrot step. */
  mandelbrot = (value) => {
    const result = this.mul(this).add(value);
    this.re = result.re;
    this.im = result.im;
    this.precision = result.precision;
    this.Decimal = result.Decimal;
    return this;
  };

  /** @param {number|string|Decimal} scalar @returns {BigComplex} Scaled value. */
  scale = (scalar) =>
    new BigComplex(
      this.re.mul(new this.Decimal(scalar)),
      this.im.mul(new this.Decimal(scalar)),
      this.precision,
    );

  /** @param {number|string|Decimal} re @param {number|string|Decimal} im @returns {BigComplex} Offset value. */
  offset = (re, im) =>
    new BigComplex(
      this.re.plus(new this.Decimal(re)),
      this.im.plus(new this.Decimal(im)),
      this.precision,
    );

  /** @param {BigComplex} value @returns {BigComplex} Complex sum. */
  add = (value) => {
    const precision = this.operation_precision(value);
    const left = this.promote(this, precision);
    const right = this.promote(value, precision);
    return new BigComplex(
      left.re.plus(right.re),
      left.im.plus(right.im),
      precision,
    );
  };

  /** @returns {BigComplex} Principal complex square root. */
  sqrt = () => {
    const magnitude = this.magnitude();
    const real_part = magnitude.plus(this.re).div(2).sqrt();
    const imaginary_magnitude = magnitude.minus(this.re).div(2).sqrt();
    const imaginary_part = this.im.isNegative()
      ? imaginary_magnitude.neg()
      : imaginary_magnitude;
    return new BigComplex(real_part, imaginary_part, this.precision);
  };

  /** @param {BigComplex} denominator @returns {BigComplex} Complex quotient. */
  divide = (denominator) => {
    const precision = this.operation_precision(denominator);
    const numerator = this.promote(this, precision);
    const divisor = this.promote(denominator, precision);
    const denominator_magnitude = divisor.re
      .mul(divisor.re)
      .plus(divisor.im.mul(divisor.im));
    return new BigComplex(
      numerator.re
        .mul(divisor.re)
        .plus(numerator.im.mul(divisor.im))
        .div(denominator_magnitude),
      numerator.im
        .mul(divisor.re)
        .minus(numerator.re.mul(divisor.im))
        .div(denominator_magnitude),
      precision,
    );
  };

  /** @returns {BigComplex} Multiplicative reciprocal. */
  reciprocal = () => new BigComplex(1, 0, this.precision).divide(this);

  /**
   * Construct a Mandelbrot parameter from polar meridian coordinates.
   *
   * @param {Decimal} radius Radius as a Decimal value.
   * @param {Decimal} theta Fraction of a full turn as a Decimal value.
   * @returns {{re: Decimal, im: Decimal}} High-precision parameter components.
   */
  P_from_r_theta = (radius, theta) => {
    const decimal_pi = this.Decimal.atan(1).times(4);
    const two_pi_theta = decimal_pi.times(2).times(theta);
    const four_pi_theta = two_pi_theta.times(2);
    const radius_squared = radius.times(radius);
    const re = radius
      .div(2)
      .times(two_pi_theta.cos())
      .minus(radius_squared.div(4).times(four_pi_theta.cos()));
    const im = radius
      .div(-2)
      .times(two_pi_theta.sin())
      .times(radius.times(two_pi_theta.cos()).minus(1));
    return { re, im };
  };
}

export default BigComplex;
