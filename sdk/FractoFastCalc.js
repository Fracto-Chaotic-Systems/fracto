import Complex from "./math/Complex.js";
import BigComplex from "./math/BigComplex.js";

const MAX_ORBITAL_SIZE = 5000
const MIN_ITERATION = 8000000  // 8 million

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
         if (iteration % 1000000000 === 0) {
            console.log('iteration', iteration)
            console.log('Q_x,Q_y,P_x,P_y', Q_x, Q_y, P_x, P_y)
         }
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

   /**
    * Experimental variant of calc() with an explicit initial orbit point.
    * The Mandelbrot parameter remains (x0, y0); seed_x/seed_y only replace
    * the initial Q value. The default calculator continues to use (0, 0).
    */
   static calc_from_seed = (
      x0,
      y0,
      seed_x = 0.5,
      seed_y = 0,
      level = 10,
      iteration_limit = null,
   ) => {
      const P_x = x0
      const P_y = y0
      let Q_x_squared = seed_x * seed_x
      let Q_y_squared = seed_y * seed_y
      let Q_x = seed_x
      let Q_y = seed_y
      let first_pos = {}
      let orbital = 0
      let least_magnitude = 1
      let best_orbital = 0
      let iteration = 1
      let estimated = false
      const iteration_factor = (MIN_ITERATION * level / 10) + MAX_ORBITAL_SIZE
      const requested_iteration_limit = Number(iteration_limit)
      const has_iteration_limit = Number.isFinite(requested_iteration_limit) && requested_iteration_limit > 0
      const max_iteration = has_iteration_limit
         ? Math.max(MAX_ORBITAL_SIZE, Math.floor(requested_iteration_limit))
         : Math.round(iteration_factor / MAX_ORBITAL_SIZE) * MAX_ORBITAL_SIZE
      for (; iteration < max_iteration; iteration++) {
         if (iteration % 1000000000 === 0) {
            console.log('iteration', iteration)
            console.log('Q_x,Q_y,P_x,P_y', Q_x, Q_y, P_x, P_y)
         }
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
               const refinement_limit = has_iteration_limit
                  ? Math.max(0, max_iteration - iteration)
                  : undefined
               if (iteration < 60000 && (refinement_limit === undefined || refinement_limit > 0)) {
                  const refined_iteration = seed_x === 0 && seed_y === 0
                     ? FractoFastCalc.best_iteration(orbital, x0, y0, refinement_limit)
                     : FractoFastCalc.best_iteration_from_seed(
                          orbital, x0, y0, seed_x, seed_y, refinement_limit)
                  if (refined_iteration > 0) iteration = refined_iteration
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

   /**
    * High-precision seeded iteration for the experimental seed survey.
    * This path is separate from both calc() and calc_from_seed(); it retains
    * Decimal coordinates through iteration and detects a return within an
    * explicit tolerance after a configurable transient.
    */
   static calc_big_complex_from_seed = (
      x0,
      y0,
      seed_x,
      seed_y,
      options = {},
   ) => {
      const configured_precision = Number(options.precision_digits)
      const configured_iteration_cap = Number(options.iteration_cap)
      const configured_transient_limit = Number(options.transient_limit)
      const precision_digits = Math.max(
         32,
         Math.floor(Number.isFinite(configured_precision) ? configured_precision : 64),
      )
      const iteration_cap = Math.max(
         1,
         Math.floor(Number.isFinite(configured_iteration_cap) ? configured_iteration_cap : 10000),
      )
      const transient_limit = Math.min(
         iteration_cap - 1,
         Math.max(
            0,
            Math.floor(Number.isFinite(configured_transient_limit) ? configured_transient_limit : 5000),
         ),
      )
      const tolerance = `${options.tolerance || "1e-40"}`
      try {
         const seed = new BigComplex(seed_x, seed_y, precision_digits)
         const parameter = new BigComplex(x0, y0, precision_digits)
         if (!seed.is_valid() || !parameter.is_valid()) {
            return {
               pattern: 0,
               iteration: 0,
               orbital_points: [],
               estimated: true,
               status: "invalid_input",
               precision_digits,
               iteration_cap,
               transient_limit,
               tolerance,
            }
         }

         const Decimal = seed.Decimal
         const parameter_re = new Decimal(parameter.re)
         const parameter_im = new Decimal(parameter.im)
         const tolerance_decimal = new Decimal(tolerance)
         if (!tolerance_decimal.isFinite() || !tolerance_decimal.gt(0)) {
            throw new Error("tolerance must be a positive finite decimal");
         }
         const tolerance_squared = tolerance_decimal.mul(tolerance_decimal)
         const advance = (re, im) => [
            re.mul(re).minus(im.mul(im)).plus(parameter_re),
            re.mul(im).mul(2).plus(parameter_im),
         ];
         const escaped = (re, im) =>
            re.mul(re).plus(im.mul(im)).gt(100);

         let current_re = new Decimal(seed.re)
         let current_im = new Decimal(seed.im)
         for (let iteration = 1; iteration <= iteration_cap; iteration++) {
            [current_re, current_im] = advance(current_re, current_im)
            if (escaped(current_re, current_im)) {
               return {
                  pattern: 0,
                  iteration,
                  orbital_points: [],
                  estimated: false,
                  status: "escaped",
                  precision_digits,
                  iteration_cap,
                  transient_limit,
                  tolerance,
               }
            }
            if (iteration <= transient_limit) {
               continue
            }

            const checkpoint_re = current_re
            const checkpoint_im = current_im
            let probe_re = current_re
            let probe_im = current_im
            let prior_probe_re = probe_re
            let prior_probe_im = probe_im
            const first_return_iteration = iteration + 1
            for (
               let return_iteration = first_return_iteration;
               return_iteration <= iteration_cap;
               return_iteration++
            ) {
               [probe_re, probe_im] = advance(probe_re, probe_im)
               if (escaped(probe_re, probe_im)) {
                  return {
                     pattern: 0,
                     iteration: return_iteration,
                     orbital_points: [],
                     estimated: false,
                     status: "escaped",
                     precision_digits,
                     iteration_cap,
                     transient_limit,
                     tolerance,
                  }
               }
               if (return_iteration % 16 === 0) {
                  const step_re = probe_re.minus(prior_probe_re);
                  const step_im = probe_im.minus(prior_probe_im);
                  const step_residual_squared = step_re
                     .mul(step_re)
                     .plus(step_im.mul(step_im));
                  if (step_residual_squared.lte(tolerance_squared)) {
                     const [next_re, next_im] = advance(probe_re, probe_im);
                     const fixed_residual_re = next_re.minus(probe_re);
                     const fixed_residual_im = next_im.minus(probe_im);
                     const fixed_residual_squared = fixed_residual_re
                        .mul(fixed_residual_re)
                        .plus(fixed_residual_im.mul(fixed_residual_im));
                     if (fixed_residual_squared.lte(tolerance_squared)) {
                        const point = { x: probe_re.toString(), y: probe_im.toString() };
                        return {
                           pattern: 1,
                           iteration: return_iteration,
                           orbital_points: [point, { ...point }],
                           estimated: false,
                           status: "cycle_candidate",
                           recurrence_residual: fixed_residual_squared.sqrt().toString(),
                           precision_digits,
                           iteration_cap,
                           transient_limit,
                           tolerance,
                        };
                     }
                  }
               }
               prior_probe_re = probe_re;
               prior_probe_im = probe_im;
               const difference_re = probe_re.minus(checkpoint_re)
               const difference_im = probe_im.minus(checkpoint_im)
               const residual_squared = difference_re
                  .mul(difference_re)
                  .plus(difference_im.mul(difference_im))
               if (residual_squared.lte(tolerance_squared)) {
                  const period = return_iteration - iteration
                  const orbital_points = []
                  let orbit_re = checkpoint_re
                  let orbit_im = checkpoint_im
                  for (let point_index = 0; point_index < period; point_index++) {
                     [orbit_re, orbit_im] = advance(orbit_re, orbit_im)
                     orbital_points.push({
                        x: orbit_re.toString(),
                        y: orbit_im.toString(),
                     })
                  }
                  if (orbital_points.length > 0) {
                     orbital_points.push({ ...orbital_points[0] })
                  }
                  return {
                     pattern: period,
                     iteration: return_iteration,
                     orbital_points,
                     estimated: false,
                     status: "cycle_candidate",
                     recurrence_residual: residual_squared.sqrt().toString(),
                     precision_digits,
                     iteration_cap,
                     transient_limit,
                     tolerance,
                  }
               }
            }
            return {
               pattern: 0,
               iteration: iteration_cap,
               orbital_points: [],
               estimated: true,
               status: "unresolved",
               precision_digits,
               iteration_cap,
               transient_limit,
               tolerance,
            }
         }
      } catch (error) {
         return {
            pattern: 0,
            iteration: 0,
            orbital_points: [],
            estimated: true,
            status: "numerical_failure",
            reason: error.message,
            precision_digits,
            iteration_cap,
            transient_limit,
            tolerance,
         }
      }
   }

   static best_iteration = (pattern, x, y, iteration_limit = 100000000) => {
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

   static best_iteration_from_seed = (
      pattern,
      x,
      y,
      seed_x,
      seed_y,
      iteration_limit = 100000000,
   ) => {
      const P_x = x
      const P_y = y
      let Q_x_squared = seed_x * seed_x
      let Q_y_squared = seed_y * seed_y
      let Q_x = seed_x
      let Q_y = seed_y
      let first_pos_x = seed_x
      let first_pos_y = seed_y
      const max_iterations = Math.min(100000000, Math.max(0, Math.floor(Number(iteration_limit) || 0)));
      for (let iteration = 0; iteration < max_iterations; iteration++) {
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
      const max_iterations = Math.min(100000000, Math.max(0, Math.floor(Number(iteration_limit) || 0)));
      for (let iteration = 0; iteration < max_iterations; iteration++) {
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
