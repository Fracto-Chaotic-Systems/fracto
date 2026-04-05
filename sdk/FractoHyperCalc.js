import Complex from "./math/Complex.js";

const MAX_ORBITAL_SIZE = 5000
const MIN_ITERATION = 10000000

export class FractoHyperCalc {

   static calc = (x0, y0, level = 10) => {
      const P_x = x0
      const P_y = y0
      let Q_x_squared = 0
      let Q_y_squared = 0
      let Q_x = 0
      let Q_y = 0
      let first_pos = {}
      let orbital = 0
      let least_magnitude = 1
      let best_orbital = 0
      let iteration = 1
      let estimated = false
      const iteration_factor = (MIN_ITERATION * level / 10) + MAX_ORBITAL_SIZE
      const max_iteration = Math.round(iteration_factor / MAX_ORBITAL_SIZE) * MAX_ORBITAL_SIZE
      for (; iteration < max_iteration; iteration++) {
         Q_y = 2 * Q_x * Q_y + P_y - Q_y_squared;
         Q_x = Q_x_squared + P_x;
         Q_x_squared = Q_x * Q_x
         Q_y_squared = Q_y * Q_y
         if (Q_x_squared + Q_y_squared > 100) {
            return {
               pattern: 0,
               iteration: iteration,
            };
         }
         if (iteration % MAX_ORBITAL_SIZE === 0) {
            first_pos = {x: Q_x, y: Q_y}
            orbital = 0
         } else if (iteration > MAX_ORBITAL_SIZE) {
            orbital++
            if (Q_x === first_pos.x && Q_y === first_pos.y) {
               const orbital_points = []
               for (let i = 0; i < orbital + 1; i++) {
                  Q_y = 2 * Q_x * Q_y + P_y - Q_y_squared;
                  Q_x = Q_x_squared + P_x;
                  Q_x_squared = Q_x * Q_x
                  Q_y_squared = Q_y * Q_y
                  orbital_points.push({
                     x: Q_x,
                     y: Q_y
                  })
               }
               return {
                  pattern: orbital,
                  iteration: iteration,
                  orbital_points: orbital_points
               };
            }
         }

         if (iteration > max_iteration - MAX_ORBITAL_SIZE) {
            estimated = true
            const difference = new Complex(Q_x - first_pos.x, Q_y - first_pos.y)
            const mag_difference = difference.magnitude()
            if (mag_difference < least_magnitude) {
               least_magnitude = mag_difference
               best_orbital = orbital
            }
         }
      }
      const orbital_points = []
      for (let i = 0; i < best_orbital + 1; i++) {
         Q_y = 2 * Q_x * Q_y + P_y - Q_y_squared;
         Q_x = Q_x_squared + P_x;
         Q_x_squared = Q_x * Q_x
         Q_y_squared = Q_y * Q_y
         orbital_points.push({
            x: Q_x,
            y: Q_y
         })
      }
      return {
         pattern: best_orbital,
         iteration: iteration,
         orbital_points: orbital_points,
         estimated,
      };
   }
}

export default FractoHyperCalc
