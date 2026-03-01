import Complex from "./math/Complex.js";
import FractoFastCalc from "./FractoFastCalc.js";

const MAX_CARDINALITY = 50000
const MAX_WORST = 100

const getFactors = (n) => {
   if (!n) return [];
   const factors = [n];
   for (let i = 1; i <= n / 2; i++) {
      if (n % i === 0) {
         if (!factors.includes(i)) {
            factors.push(i);
         }
      }
   }
   factors.sort((a, b) => a - b);
   return factors;
}

export const projection_calc = (P_re, P_im) => {
   const matrix = Array.from({length: MAX_CARDINALITY}, () => []);
   const P = new Complex(P_re, P_im);
   const Q = new Complex(0, 0);
   let best_delta = 100
   let best_cardinality = 0
   let eliminated = 0
   let iteration = 1
   const all_factors = Array.from({length: MAX_CARDINALITY}, (_, i) => getFactors(i));
   const test_start = performance.now()
   for (; iteration < MAX_CARDINALITY; iteration++) {
      Q.mandelbrot(P)
      matrix[iteration].push({re: Q.re, im: Q.im})
      const factors = all_factors[iteration];
      for (const cardinality of factors) {
         if (matrix[cardinality][0].eliminated) {
            continue
         }
         const cycle = iteration / cardinality
         if (cycle === 1) {
            continue
         }
         const reference_Q = matrix[iteration - cardinality][0]
         const delta_re = reference_Q.re - Q.re
         const delta_im = reference_Q.im - Q.im
         const magnitude = delta_re * delta_re + delta_im * delta_im
         const previous_index = matrix[cardinality].length - 1
         if (previous_index) {
            const rate = matrix[cardinality][previous_index] - magnitude
            if (rate < 0) {
               matrix[cardinality][0].eliminated = true
               eliminated++
               if (best_cardinality === cardinality) {
                  best_delta = 1000
                  best_cardinality = 0
               }
            } else if (magnitude < best_delta) {
               best_delta = magnitude
               best_cardinality = cardinality
            }
         }
         if (!best_delta) {
            break
         }
         matrix[cardinality].push(magnitude)
      }
      if (!best_delta) {
         break
      }
   }
   const test_end = performance.now()

   // console.log(matrix);
   console.log(`best_cardinality = ${best_cardinality}`);
   console.log(`best_delta = ${best_delta}`);
   console.log(`eliminated = ${eliminated} (${eliminated * 100 /MAX_CARDINALITY}%)`);
   console.log(`iteration = ${iteration} in ${test_end - test_start}ms`);
   console.log(`Q = ${Q.toString()}`);
   const start = performance.now()
   const calc_results = FractoFastCalc.calc(P_re, P_im);
   const end = performance.now()
   console.log(`FractoFastCalc in ${end - start}ms`, calc_results.pattern, calc_results.iteration);
   console.log(matrix[calc_results.pattern]);
}

projection_calc(-0.249960805, 0.6352927454)