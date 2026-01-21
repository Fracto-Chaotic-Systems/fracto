export class Complex {

   re = 0;
   im = 0;

   constructor(re, im) {
      this.re = re;
      this.im = im;
   }

   toString = () => {
      return `${this.re}+${this.im}i`;
   }

   compare = (z) => {
      const this_str = this.toString();
      const z_str = z.toString();
      return this_str === z_str;
   }

   is_valid = () => {
      return !(isNaN(this.re) || isNaN(this.im));
   }

   magnitude = () => {
      if (isNaN(this.re) || isNaN(this.im)) {
         return -1;
      }
      return Math.sqrt(this.re * this.re + this.im * this.im)
   }

   mul = (z) => {
      const a = this.re;
      const b = this.im;
      const c = z.re;
      const d = z.im;
      return new Complex(a * c - b * d, a * d + b * c)
   }

   fast_mul = (z) => {
      const a = this.re;
      const b = this.im;
      const c = z.re;
      const d = z.im;
      this.re = a * c - b * d
      this.im = a * d + b * c
      return this
   }

   divide = (den) => {
      const com_conj = new Complex(den.im, den.re);
      return this.mul(com_conj);
   }

   reciprocal = () => {
      const one = new Complex(1.0, 0)
      return one.divide(this);
   }

   scale = (s) => {
      return new Complex(s * this.re, s * this.im);
   }

   offset = (re, im) => {
      return new Complex(this.re + re, this.im + im);
   }

   add = (z) => {
      return new Complex(this.re + z.re, this.im + z.im);
   }

   sqrt = () => {
      const mag = this.magnitude()
      const first_part = Math.sqrt((mag + this.re) / 2)
      const sign = this.im / Math.abs(this.im)
      const second_part = sign * Math.sqrt((mag - this.re) / 2)
      return new Complex(first_part, second_part)
   }

   nth_root = (n) => {
      const r = this.magnitude()
      const nth_root_r = Math.pow(r, 1 / n);
      const theta = Math.atan2(this.im, this.re)
      return new Complex(
         nth_root_r * Math.cos(theta / n),
         nth_root_r * Math.sin(theta / n)
      )
   }

   pow = (n) => {
      const r = this.magnitude()
      const r_to_n = Math.pow(r, n);
      const n_times_theta = n * Math.atan2(this.im, this.re)
      return new Complex(
         r_to_n * Math.cos(n_times_theta),
         r_to_n * Math.sin(n_times_theta)
      )
   }

   rational_root = (m, n) => {
      let multiplier = new Complex(1, 0)
      for (let i = 0; i < m; i++) {
         multiplier = multiplier.mul(this);
      }
      return multiplier.nth_root(n)
   }

   ln = () => {
      const mag = this.magnitude()
      const angle = Math.atan2(this.im, this.re)
      return new Complex(mag, angle)
   }

   static solve_quadratic = (a, b, c) => {
      const b_squared = b.mul(b)
      const negative_four_a_c = a.mul(c).scale(-4)
      const under_radical = b_squared.add(negative_four_a_c)
      const negative_b = b.scale(-1)
      const positive_radical = under_radical.sqrt()
      const negative_radical = positive_radical.scale(-1)
      const numerator1 = negative_b.add(positive_radical)
      const numerator2 = negative_b.add(negative_radical)
      const two_a = a.scale(2)
      return [
         numerator1.divide(two_a),
         numerator2.divide(two_a),
      ]
   }

   slow_mandelbrot = (z) => {
      const Q_squared = this.mul(this)
      return Q_squared.add(z)
   }

   mandelbrot = (z) => {
      const re_part = this.re * this.re - this.im * this.im;
      const im_part = this.re * this.im + this.im * this.re;
      this.re = re_part + z.re
      this.im = im_part + z.im
      return this
   }

}

export default Complex;
