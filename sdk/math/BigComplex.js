import Decimal from "decimal.js";

const RESOLUTION_DIGITS = 32
const MAX_COMPARE_DIGITS = RESOLUTION_DIGITS;

Decimal.set({precision: RESOLUTION_DIGITS, rounding: 2})

export class BigComplex {

   re;
   im;

   constructor(re, im, resolution_digits = RESOLUTION_DIGITS) {
      this.re = new Decimal(re);
      this.im = new Decimal(im);
   }

   get_re = (digits = 30) => {
      const re_str = `${this.re}`;
      return parseFloat(re_str.substring(0, digits))
   }

   get_im = (digits = 30) => {
      const im_str = `${this.im}`;
      return parseFloat(im_str.substring(0, digits))
   }

   is_valid = () => {
      if (isNaN(this.re.toNumber())) {
         return false;
      }
      if (isNaN(this.im.toNumber())) {
         return false;
      }
      return true;
   }

   toString = (limit = MAX_COMPARE_DIGITS) => {
      const re_str = `${this.re.toString()}`;
      const im_str = `${this.im.toString()}`;
      return `[${re_str}, ${im_str}]`;
   }

   compare = (z, limit = MAX_COMPARE_DIGITS) => {
      const re_differs = this.re.toString() !== z.re.toString();
      if (re_differs) {
         return false;
      }
      const im_differs = this.im.toString() !== z.im.toString();
      if (im_differs) {
         return false;
      }
      return true;
   }

   magnitude = () => {
      if (this.re.isNaN() || this.im.isNaN()) {
         return -1;
      }
      const re_squared = this.re.mul(this.re);
      const im_squared = this.im.mul(this.im);
      const sum_squares = re_squared.add(im_squared);
      return sum_squares.sqrt()
   }

   mul = (z) => {
      const re_left_part = this.re.mul(z.re);
      const re_right_part = this.im.mul(z.im);
      const re_part = re_left_part.sub(re_right_part);
      const im_left_part = this.re.mul(z.im);
      const im_right_part = this.im.mul(z.re);
      const im_part = im_left_part.add(im_right_part);
      return new BigComplex(re_part, im_part)
   }

   mandelbrot = (z) => {
      const re_left_part = this.re.mul(this.re);
      const re_right_part = this.im.mul(this.im);
      const re_part = re_left_part.sub(re_right_part);
      const im_left_part = this.re.mul(this.im);
      const im_right_part = this.im.mul(this.re);
      const im_part = im_left_part.add(im_right_part);
      this.re = re_part.add(z.re)
      this.im = im_part.add(z.im)
      return this
   }

   P_from_r_theta = (r, theta) => {
      const two_pi_high_precision = Decimal.atan(1).times(2);
      const r_squared = r.mul(r)
      const two_pi_theta = two_pi_high_precision.mul(theta)
      const four_pi_theta = two_pi_theta.mul(2)
      const cos_two_pi_theta = two_pi_theta.cos()
      const cos_four_pi_theta = four_pi_theta.cos()
      const sin_two_pi_theta = two_pi_theta.sin()
      const r_by_2 = r.div(2)
      const r_squared_by_four = r_squared.div(4)
      const r_by_2_times_cos_two_pi_theta = r_by_2.mul(cos_two_pi_theta)
      const r_squared_by_four_times_cos_four_pi_theta = r_squared_by_four.mul(cos_four_pi_theta)
      const re = r_by_2_times_cos_two_pi_theta.minus(r_squared_by_four_times_cos_four_pi_theta)
      const negative_r_by_2 = r_by_2.mul(-1)
      const r_cos_two_pi_theta = r.mul(cos_two_pi_theta)
      const r_cos_two_pi_theta_minus_1 = r_cos_two_pi_theta.sub(1)
      const im = negative_r_by_2.mul( sin_two_pi_theta).mul(r_cos_two_pi_theta_minus_1)
      return {re, im}
   }

   divide = (den) => {
      const com_conj = new BigComplex(den.im, den.re);
      return this.mul(com_conj);
   }

   // log = () => {
   //    const z = this.math.complex(this.re, this.im);
   //    const result = this.math.log(z);
   //    return new BigComplex(result.re, result.im)
   // }

   scale = (s) => {
      return new BigComplex(
         this.re.mul(s),
         this.im.mul(s)
      );
   }

   offset = (re, im) => {
      return new BigComplex(
         this.re.add(re),
         this.im.add(im)
      );
   }

   add = (c) => {
      return new BigComplex(this.re.add(c.re), this.im.add(c.im));
   }

   sqrt = () => {
      const re_squared = this.re.mul(this.re);
      // console.log("re_squared",re_squared.toString())

      const im_squared = this.im.mul(this.im);
      // console.log("im_squared",im_squared.toString())

      const sum_squares = re_squared.add(im_squared);
      // console.log("sum_squares",sum_squares.toString())

      const magnitude = sum_squares.sqrt()
      // console.log("magnitude",magnitude.toString())

      const re = magnitude.add(this.re).mul(0.5).sqrt();
      // console.log("re",re.toString())

      const im = magnitude.sub(this.re).mul(0.5).sqrt().mul(this.im.s);
      // console.log("im",im.toString())

      return new BigComplex(re, im);
   }

   // cube_root = () => {
   //    const one = this.math.bignumber(1);
   //    const three = this.math.bignumber(3);
   //    const exponent = new BigComplex(one.div(three), 0)
   //    return this.pow(exponent)
   // }
   //
   // nth_root = (n) => {
   //    const r = this.magnitude()
   //    const nth_root_r = this.pow(r, 1 / n);
   //    const theta = this.math.atan2(this.im, this.re)
   //    return new BigComplex(
   //       nth_root_r * this.math.cos(theta / n),
   //       nth_root_r * this.math.sin(theta / n)
   //    )
   // }
   //
   // pow = (exponent) => {
   //    // Convert base to polar form (r * e^(i*theta))
   //    const r = this.magnitude();
   //    const theta = this.math.atan2(this.im, this.re);
   //    // console.log('pow, exponent', exponent.toString())
   //
   //    // Apply Euler's formula for z^w = e^(w * ln(z))
   //    // where ln(z) = ln(r) + i*theta
   //    const ln_r = this.math.log(r);
   //    const exponent_re_times_ln_r = exponent.re.mul(ln_r)
   //    const exponent_im_times_ln_r = exponent.im.mul(ln_r)
   //    const exponent_re_times_theta = exponent.re.mul(theta)
   //    const exponent_im_times_theta = exponent.im.mul(theta)
   //
   //    const term_re = exponent_re_times_ln_r.add(-exponent_im_times_theta);
   //    const term_im = exponent_im_times_ln_r.add(exponent_re_times_theta)
   //
   //    const magnitude = this.math.exp(term_re);
   //    const cos_im = this.math.cos(term_im)
   //    const sin_im = this.math.sin(term_im)
   //    const result_re = magnitude.mul(cos_im)
   //    const result_im = magnitude.mul(sin_im)
   //
   //    return new BigComplex(result_re, result_im);
   // }
}

export default BigComplex;
