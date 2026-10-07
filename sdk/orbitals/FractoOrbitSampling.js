const DEFAULT_ITERATIONS = 4096;
const MAX_ITERATIONS = 1_000_000;

/**
 * Sample a Mandelbrot orbit from an explicit initial state.
 *
 * @param {{re:number|string, im:number|string}} point Mandelbrot parameter.
 * @param {{iterations?:number,seed?:{re:number|string,im:number|string}}} [options]
 *   Sampling limits and initial state. Defaults to the critical seed z=0.
 * @returns {{samples:Array<{iteration:number,re:number,im:number,radius:number}>, escaped:boolean, iterations:number}}
 *   Orbit samples and termination metadata. `radius` is the actual
 *   vector magnitude `|z|` from the origin; it is not distance from Q.
 */
export const sample_orbit = (point, options = {}) => {
  const iterations = Math.min(
    MAX_ITERATIONS,
    Math.max(1, Math.floor(Number(options.iterations) || DEFAULT_ITERATIONS)),
  );
  const c_re = Number(point.re);
  const c_im = Number(point.im);
  let z_re = Number(options.seed?.re ?? options.seed?.x ?? 0);
  let z_im = Number(options.seed?.im ?? options.seed?.y ?? 0);
  let escaped = false;
  const samples = [];
  for (let iteration = 0; iteration <= iterations; iteration += 1) {
    samples.push({
      iteration,
      re: z_re,
      im: z_im,
      radius: Math.hypot(z_re, z_im),
    });
    if (iteration === iterations) break;
    const next_re = z_re * z_re - z_im * z_im + c_re;
    z_im = 2 * z_re * z_im + c_im;
    z_re = next_re;
    if (!Number.isFinite(z_re) || !Number.isFinite(z_im)) {
      escaped = true;
      break;
    }
  }
  return { samples, escaped, iterations };
};

/** Sample the critical Mandelbrot orbit beginning at z=0. */
export const sample_critical_orbit = (point, options = {}) =>
  sample_orbit(point, { ...options, seed: { re: 0, im: 0 } });
