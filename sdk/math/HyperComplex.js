import Complex from "./Complex.js";

export class HyperComplex {

   re = 0;
   im = 0;
   hn = 0;
   hc = 0;

   constructor(re, im, hn, hc) {
      this.re = re; // real part
      this.im = im; // imaginary part
      this.hn = hn; // hyper-numeric part
      this.hc = hc; // hyper-complex part
   }

   toString = () => {
      return `${this.re}+${this.im}i+${this.hn}h+${this.hc}ih`;
   }

   squared = () => {
      const {re, im, hn, hc} = this
      const a = re * re - im * im;
      const b = 2 * re * im;
      const c = 2 * re * hn - 2 * im * hc - hn * hn + hc * hc;
      const d = 2 * re * hc + 2 * im * hn - 2 * hn * hc;
      return new HyperComplex(a, b, c, d)
   }

   add = (y) => {
      const {re, im, hn, hc} = y
      return new HyperComplex(
         re + this.re,
         im + this.im,
         hn + this.hn,
         hc + this.hc)
   }
}

export default HyperComplex;
