/** Cyclic complex product of consecutive orbital-point sums. */
export const orbital_confirmation = (points, magnitude) => {
  if (!(magnitude > 0.25) || !points.length) return null;
  let re = 1;
  let im = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return null;
    const sum_re = a.x + b.x;
    const sum_im = a.y + b.y;
    const next_re = re * sum_re - im * sum_im;
    im = re * sum_im + im * sum_re;
    re = next_re;
    if (!Number.isFinite(re) || !Number.isFinite(im)) return null;
  }
  const length = Math.hypot(re, im);
  const length_error = Math.abs(length - 1);
  return {
    re,
    im,
    length,
    length_error,
    confidence: Math.max(0, 1 - length_error),
  };
};

/** Absolute Euclidean tolerance for each transition, including last-to-first. */
export const ORBIT_CLOSURE_TOLERANCE = 1e-7;

export const orbital_closure_error = (points, parameter) => {
  if (
    !points.length ||
    !Number.isFinite(parameter?.x) ||
    !Number.isFinite(parameter?.y)
  )
    return null;
  let maximum = 0;
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    const error = Math.hypot(
      point.x * point.x - point.y * point.y + parameter.x - next.x,
      2 * point.x * point.y + parameter.y - next.y,
    );
    if (!Number.isFinite(error)) return null;
    maximum = Math.max(maximum, error);
  }
  return maximum;
};
