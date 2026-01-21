import Complex from "./math/Complex.js";
import BigComplex from "./math/BigComplex.js";

const MAX_ORBITAL_SIZE = 5000
const MIN_ITERATION = 10000000000

export class FractoFastCalc {

   static point_in_main_cardioid = (x0, y0) => {
      const P = new Complex(x0, y0)
      const negative_four_P = P.scale(-4)
      const one_minus_four_p = negative_four_P.offset(1, 0)
      const sqrt_one_minus_four_p = one_minus_four_p.sqrt()
      const negative_sqrt_one_minus_four_p = sqrt_one_minus_four_p.scale(-1)
      const one_minus_sqrt_one_minus_four_p = negative_sqrt_one_minus_four_p.offset(1, 0)
      const magnitude = one_minus_sqrt_one_minus_four_p.magnitude()
      if (magnitude < 0) {
         return false
      }

      return magnitude <= 1;
   }

   static super_calc = (x0, y0) => {
      if (FractoFastCalc.point_in_main_cardioid(x0, y0)) {
         return FractoFastCalc.calc(x0, y0)
      }
      const P_x = x0
      const P_y = y0
      let Q_x_squared = 0
      let Q_y_squared = 0
      let Q_x = 0
      let Q_y = 0
      let iteration = 1
      let pattern = 0
      let current_minimum = 10
      const max_iteration = 100000000 // one hundred million
      for (; iteration < max_iteration; iteration++) {
         Q_y = 2 * Q_x * Q_y + P_y;
         Q_x = Q_x_squared - Q_y_squared + P_x;
         Q_x_squared = Q_x * Q_x
         Q_y_squared = Q_y * Q_y
         const sum_squares = Q_x_squared + Q_y_squared
         if (sum_squares > 100) {
            return {pattern, iteration};
         }
         if (sum_squares < current_minimum) {
            current_minimum = sum_squares
            pattern = iteration
         }
         if (100 * pattern < iteration) {
            const true_iteration = FractoFastCalc.best_iteration(pattern, x0, y0)
            return {pattern, true_iteration};
         }
      }
   }

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
         Q_y = 2 * Q_x * Q_y + P_y;
         Q_x = Q_x_squared - Q_y_squared + P_x;
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
                  Q_y = 2 * Q_x * Q_y + P_y;
                  Q_x = Q_x_squared - Q_y_squared + P_x;
                  Q_x_squared = Q_x * Q_x
                  Q_y_squared = Q_y * Q_y
                  orbital_points.push({
                     x: Q_x,
                     y: Q_y
                  })
               }
               if (iteration < 60000) {
                  iteration = FractoFastCalc.best_iteration(orbital, x0, y0)
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
         Q_y = 2 * Q_x * Q_y + P_y;
         Q_x = Q_x_squared - Q_y_squared + P_x;
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

   static best_iteration = (pattern, x, y) => {
      const P_x = x
      const P_y = y
      let Q_x_squared = 0
      let Q_y_squared = 0
      let Q_x = 0
      let Q_y = 0
      let first_pos_x = x
      let first_pos_y = y
      for (let iteration = 0; iteration < 100000000; iteration++) {
         Q_y = 2 * Q_x * Q_y + P_y;
         Q_x = Q_x_squared - Q_y_squared + P_x;
         Q_x_squared = Q_x * Q_x
         Q_y_squared = Q_y * Q_y
         if (iteration % pattern === 0 && iteration) {
            if (Q_x === first_pos_x && Q_y === first_pos_y) {
               return iteration
            }
            first_pos_x = Q_x
            first_pos_y = Q_y
         }
      }
      return -1
   }

   static best_big_iteration = (pattern, x, y) => {
      let P = new BigComplex(x, y)
      let Q = new BigComplex(0, 0)
      let Q_squared = new BigComplex(0, 0)
      let first_pos = new BigComplex(0, 0)
      const all_points = new Array(pattern)
      for (let iteration = 0; iteration < 100000000; iteration++) {
         Q_squared = Q.mul(Q)
         Q = Q_squared.add(P)
         all_points[iteration % pattern] = Q
         if (iteration % pattern === 0 && iteration) {
            if (Q.compare(first_pos, 20)) {
               return all_points
            }
            first_pos = Q
         }
      }
      return -1
   }

   static calculate_cardioid_Q = (x, y, scalar = 1) => {
      const P = new Complex(x, y)
      const negative_four_P = P.scale(-4.0)
      const under_radical = negative_four_P.offset(1, 0)
      const radical = under_radical.sqrt().scale(scalar)
      const result = radical.offset(1.0, 0).scale(0.5)
      return {x: result.re, y: result.im}
   }

   static calculate_big_cardioid_Q = (x, y, scalar = 1) => {
      const P = new BigComplex(x, y)
      const negative_four_P = P.scale(-4.0)
      const under_radical = negative_four_P.offset(1, 0)
      const radical = under_radical.sqrt().scale(scalar)
      const result = radical.offset(1.0, 0).scale(0.5)
      return {x: result.get_re(), y: result.get_im()}
   }
   
   static get_meridian_point = (m, theta_num, theta_den) => {
      const m_squared = m * m
      const theta = theta_num / theta_den
      const two_pi_theta = 2 * Math.PI * theta
      const four_pi_theta = 2 * two_pi_theta
      const cos_two_pi_theta = Math.cos(two_pi_theta)
      const cos_four_pi_theta = Math.cos(four_pi_theta)
      const sin_two_pi_theta = Math.sin(two_pi_theta)
      // const sin_four_pi_theta = Math.sin(four_pi_theta)
      const m_by_2 = m / 2
      const m_squared_by_four = m_squared / 4
      const x = m_by_2 * cos_two_pi_theta - m_squared_by_four * cos_four_pi_theta
      const y = -m_by_2 * sin_two_pi_theta * (m * cos_two_pi_theta - 1)
      return {x: x, y: y}
   }
}

export default FractoFastCalc
