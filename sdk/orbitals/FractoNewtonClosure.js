import BigComplex from "../math/BigComplex.js";

export const NEWTON_CLOSURE_TOLERANCE = 1e-7;

/** Validate the returned cycle, never the size of its Newton update alone. */
export const validate_newton_closure = (result, parameter) => {
  const points = result.point_list || [];
  let error = null;
  if (points.length && Number.isFinite(Number(parameter.x)) && Number.isFinite(Number(parameter.y))) {
    error = 0;
    for (let index = 0; index < points.length; index++) {
      const point = points[index], next = points[(index + 1) % points.length];
      let residual;
      if (point instanceof BigComplex) {
        const c = new BigComplex(parameter.x, parameter.y, point.precision);
        residual = Number(point.mul(point).add(c).add(next.scale(-1)).magnitude());
      } else {
        residual = Math.hypot(
          point.re * point.re - point.im * point.im + Number(parameter.x) - next.re,
          2 * point.re * point.im + Number(parameter.y) - next.im,
        );
      }
      if (!Number.isFinite(residual)) { error = null; break; }
      error = Math.max(error, residual);
    }
  }
  const closure_reached = error !== null && error <= NEWTON_CLOSURE_TOLERANCE;
  return {
    ...result,
    status: closure_reached ? "closure_reached" : ["cardinality_required", "invalid_seed"].includes(result.status) ? result.status : "closure_not_reached",
    closure_reached,
    closure_error: error,
    closure_tolerance: NEWTON_CLOSURE_TOLERANCE,
    candidate_cardinality: result.cardinality || result.least_magnitude_N || 0,
    cardinality: closure_reached ? result.cardinality : 0,
    point_list: closure_reached ? points : [],
  };
};
