import Complex from "../math/Complex.js";

/**
 * Refine an orbital point with the derived Newton method.
 *
 * @param {{x:number,y:number}} point Mandelbrot parameter.
 * @param {number} limit Maximum Newton iterations.
 * @param {number} [known_cardinality] Evaluate only this cardinality when supplied.
 * @returns {object} Newton result and convergence metadata.
 */
export const newton_derived = (point, limit, known_cardinality = null) => {
  let least_magnitude = 1000;
  let least_magnitude_N = 0;
  let least_magnitude_point_list = [];
  const start = performance.now();
  // A tolerance below roughly 1e-16 cannot be reached reliably with a
  // JavaScript Number, so 1e-12 is a practical Newton convergence target.
  const tolerance_squared = 1e-16;
  const requested_cardinality = Number(known_cardinality);
  const cardinality_supplied =
    known_cardinality !== null &&
    known_cardinality !== undefined &&
    Number.isInteger(requested_cardinality) &&
    requested_cardinality >= 1;
  if (!cardinality_supplied) {
    return {
      status: "cardinality_required",
      point_list: [],
      cardinality: 0,
      cycles: 0,
      time: "0ms",
      least_magnitude: null,
      least_magnitude_N: 0,
      cardinality_supplied: false,
    };
  }
  const cardinalities = [requested_cardinality];
  for (const N of cardinalities) {
    // Start at zero, to find the orbital point closest to the origin
    let z0_re = 0;
    let z0_im = 0;
    for (let i = 1; i <= limit; i++) {
      // Evaluate the orbit and simultaneously compute the product derivative
      let current_re = z0_re;
      let current_im = z0_im;
      let derivative_re = 1;
      let derivative_im = 0;
      for (let k = 0; k < N; k++) {
        const doubled_re = current_re * 2;
        const doubled_im = current_im * 2;
        const next_derivative_re =
          derivative_re * doubled_re - derivative_im * doubled_im;
        derivative_im = derivative_re * doubled_im + derivative_im * doubled_re;
        derivative_re = next_derivative_re;

        const next_current_re =
          current_re * current_re - current_im * current_im + point.x;
        current_im = current_re * current_im * 2 + point.y;
        current_re = next_current_re;

        if (Number.isNaN(current_re)) {
          // console.log('Number.isNaN(current_re)')
          break;
        }
        if (Number.isNaN(current_im)) {
          // console.log('Number.isNaN(current_im)')
          break;
        }
      }
      if (Number.isNaN(current_re)) {
        // console.log('Number.isNaN(current_re)')
        break;
      }
      if (Number.isNaN(current_im)) {
        // console.log('Number.isNaN(current_im)')
        break;
      }

      // H(z_0) = f^{(N)}(z_0) - z_0
      const h_re = current_re - z0_re;
      const h_im = current_im - z0_im;
      if (Number.isNaN(h_re)) {
        break;
      }
      if (Number.isNaN(h_im)) {
        break;
      }

      // H'(z_0) = product(2*z_k) - 1
      const h_prime_re = derivative_re - 1;
      const h_prime_im = derivative_im;
      if (Number.isNaN(h_prime_re)) {
        break;
      }
      if (Number.isNaN(h_prime_im)) {
        break;
      }

      // Newton division: H / H_prime
      const denom = h_prime_re * h_prime_re + h_prime_im * h_prime_im;
      const step_re = (h_re * h_prime_re + h_im * h_prime_im) / denom;
      const step_im = (h_im * h_prime_re - h_re * h_prime_im) / denom;
      if (Number.isNaN(step_re)) {
        break;
      }
      if (Number.isNaN(step_im)) {
        break;
      }

      // Convergence check (if the step size is tiny, we found a root)
      const magnitude_squared = step_re * step_re + step_im * step_im;
      if (!Number.isFinite(magnitude_squared)) {
        break;
      }
      if (magnitude_squared === 0) {
        const point_list = [];
        let exact_re = z0_re;
        let exact_im = z0_im;
        for (let k = 0; k < N; k += 1) {
          const next_re = exact_re * exact_re - exact_im * exact_im + point.x;
          exact_im = 2 * exact_re * exact_im + point.y;
          exact_re = next_re;
          point_list.push(new Complex(exact_re, exact_im));
        }
        const end = performance.now();
        return {
          point_list,
          cardinality: N,
          cycles: i,
          time: `${end - start}ms`,
          least_magnitude: 0,
          least_magnitude_N: N,
          cardinality_supplied,
        };
      }
      if (magnitude_squared > 0) {
        if (magnitude_squared < least_magnitude * least_magnitude) {
          least_magnitude = Math.sqrt(magnitude_squared);
          least_magnitude_N = N;
          least_magnitude_point_list = [];
          for (let k = 0; k < N; k++) {
            const next_current_re =
              current_re * current_re - current_im * current_im + point.x;
            current_im = current_re * current_im * 2 + point.y;
            current_re = next_current_re;
            least_magnitude_point_list.push(
              new Complex(current_re, current_im),
            );
          }
        }
        if (magnitude_squared < tolerance_squared) {
          const point_list = [];
          current_re = z0_re;
          current_im = z0_im;
          for (let k = 0; k < N; k++) {
            const next_current_re =
              current_re * current_re - current_im * current_im + point.x;
            current_im = current_re * current_im * 2 + point.y;
            current_re = next_current_re;
            point_list.push(new Complex(current_re, current_im));
          }
          const end = performance.now();
          return {
            point_list,
            cardinality: N,
            cycles: i,
            time: `${end - start}ms`,
            least_magnitude: least_magnitude,
            least_magnitude_N: least_magnitude_N,
            cardinality_supplied,
          };
        }
      }

      // Update guess
      z0_re -= step_re;
      z0_im -= step_im;
    }
  }
  const end = performance.now();
  return {
    point_list: least_magnitude_point_list,
    cardinality: least_magnitude_N,
    cycles: limit,
    time: `${end - start}ms`,
    least_magnitude: least_magnitude,
    least_magnitude_N: least_magnitude_N,
    cardinality_supplied,
  };
};

// TEST
// const point = {x: -0.7436128502235405, y: 0.09298817483611424}
//
// const start1 = performance.now();
// const result1 = newton_derived(point, 6)
// const end1 = performance.now();
//
// const start2 = performance.now();
// const result2 = FractoFastCalc.calc(point.x, point.y)
// const end2 = performance.now();
//
// const time1 = end1 - start1
// const time2 = end2 - start2
// const iteration_1 = result1.cycles * result1.cardinality
// const iteration_2 = result2.iteration
// console.log(`result1 cardinality: ${result1.cardinality}, cycles: ${result1.cycles} (${iteration_1} iterations), time: ${time1}ms, least_magnitude: ${result1.least_magnitude}, least_magnitude_N:${result1.least_magnitude_N}`);
// console.log(`result2 cardinality: ${result2.pattern}, iteration: ${iteration_2}, time: ${time2}ms`);
// console.log(`time difference: ${time1 / time2}x, cycles difference: ${iteration_1 / iteration_2}x`)
