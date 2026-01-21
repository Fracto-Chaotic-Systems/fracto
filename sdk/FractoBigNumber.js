import BigComplex from "./math/BigComplex.js";
import Complex from "./math/Complex.js";

export class FractoBigNumber {

   static calculate_focal_Q = (x, y, high_precision = true) => {
      const P = high_precision
         ? new BigComplex(x, y)
         : new Complex(x, y)
      const negative_four_P = P.scale(-4.0)
      const under_radical = negative_four_P.offset(1, 0)
      const radical = under_radical.sqrt().scale(-1)
      const result = radical.offset(1.0, 0).scale(0.5)
      return {x: result.re, y: result.im}
   }

   static calc = (x, y, zoomies = 0, high_precision = true) => {
      const start = performance.now()
      const P = high_precision
         ? new BigComplex(x, y)
         : new Complex(x, y)
      const focal_Q = FractoBigNumber.calculate_focal_Q(x, y, high_precision)
      const negative_focal_Q = high_precision
         ? new BigComplex(-focal_Q.x, -focal_Q.y)
         : new Complex(-focal_Q.x, -focal_Q.y)
      let Q = high_precision
         ? new BigComplex(0, 0)
         : new Complex(0, 0)
      let calc_points = {
         [Q.toString()]: 0
      }
      let all_points = []
      let offset = zoomies
      let iteration = 1;
      let pattern = 0;
      let max_magnitude = 0
      const batch_length = 100000000
      const batch_count = Math.ceil(zoomies / batch_length)
      for (let batch = 0; batch < batch_count; batch++) {
         if (batch % 10 === 0) {
            console.log(`iteration ${(batch + 1) * batch_length}`)
         }
         for (let i = 0; i < batch_length; i++, iteration++) {
            Q = Q.mandelbrot(P)
         }
      }
      const zoomies_time = performance.now()
      for (; iteration > 0; iteration++) {
         Q = Q.mandelbrot(P)
         all_points.push({x: Q.re, y: Q.im})
         const Q_str = Q.toString()
         if (calc_points[Q_str]) {
            const first_iteration = calc_points[Q_str]
            pattern = iteration - first_iteration
            for (let index = 0; index < pattern; index++) {
               const iteration_point = all_points[iteration - offset - index]
               if (!iteration_point) {
                  continue;
               }
               const vertex = high_precision
                  ? new BigComplex(iteration_point.x, iteration_point.y)
                  : new Complex(iteration_point.x, iteration_point.y)
               const segment = vertex.add(negative_focal_Q)
               const magnitude_value = segment.magnitude()
               const magnitude = parseFloat(magnitude_value.toString())
               if (magnitude > max_magnitude) {
                  max_magnitude = magnitude
               }
            }
            if (max_magnitude) {
               break;
            }
         }
         calc_points[Q_str] = iteration
         if (all_points.length === 1000) {
            for (let i = 0; i < batch_length * 10; i++, iteration++) {
               Q = Q.mandelbrot(P)
            }
            console.log(`calc_points ${iteration}`)
            calc_points = {}
            offset = iteration
            all_points = []
         }
      }
      const finish = performance.now()
      return {
         pattern,
         magnitude: max_magnitude,
         runtime_ms: finish - zoomies_time,
         zoomies_ms: zoomies_time - start,
         iteration,
         x,
         y,
      }
   }
}

export default FractoBigNumber
