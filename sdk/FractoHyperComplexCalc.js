import HyperComplex from "./math/HyperComplex.js";

const MAX_ORBITAL_SIZE = 10000
const MAX_ITERATION = 100000000
const ESCAPE_VALUE = 100

export class FractoHyperComplexCalc {

   static calc = (re, im, hn, hc) => {
      const P = new HyperComplex(re, im, hn, hc)
      let Q = new HyperComplex(0, 0, 0, 0)
      let all_Qs = {}
      let iteration = 0
      for (; iteration < MAX_ITERATION; iteration++) {
         const Q_squared = Q.squared()
         if (Math.abs(Q_squared.re) > ESCAPE_VALUE || Number.isNaN(Q_squared.re)
            || Math.abs(Q_squared.im) > ESCAPE_VALUE || Number.isNaN(Q_squared.im)
            || Math.abs(Q_squared.hn) > ESCAPE_VALUE || Number.isNaN(Q_squared.hn)
            || Math.abs(Q_squared.hc) > ESCAPE_VALUE || Number.isNaN(Q_squared.hc)
         ) {
            return {
               pattern: 0,
               iteration,
            }
         }
         Q = Q_squared.add(P)
         const Q_str = Q.toString()
         // console.log(Q_str)
         if (all_Qs[Q_str] && iteration > 10) {
            return {
               pattern: iteration - all_Qs[Q_str],
               iteration,
            }
         }
         if (iteration % MAX_ORBITAL_SIZE === 0) {
            all_Qs = {}
         }
         all_Qs[Q_str] = iteration
      }
      return {
         pattern:0,
         iteration
      }
   }
}

export default FractoHyperComplexCalc
