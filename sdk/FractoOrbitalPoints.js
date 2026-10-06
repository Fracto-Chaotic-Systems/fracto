import FractoFastCalc from "./FractoFastCalc.js";
import FractoUtil from "./FractoUtil.js";
import FractoCardinality from "./FractoCardinality.js";
import { newton_derived } from "./orbitals/FractoNewtonDerived.js";
import { newton_big_complex } from "./orbitals/FractoNewtonBigComplex.js";

const normalize_point = (point) => {
  const re = point?.re ?? point?.x;
  const im = point?.im ?? point?.y;
  if (!Number.isFinite(Number(re)) || !Number.isFinite(Number(im))) return null;
  return { re: String(re), im: String(im) };
};

const with_diagnostics = (result, mode, cardinality, source, precision_digits) => ({
  ...result,
  diagnostics: {
    mode,
    supplied_cardinality: cardinality,
    cardinality_source: source,
    precision_digits,
    least_newton_step: String(result.least_magnitude),
    best_cardinality_matches_input: result.least_magnitude_N === cardinality,
    residual_type: "least Newton step magnitude",
  },
});

/**
 * Obtain the SDK's best-known cardinality candidate and refine it into orbital
 * points with the selected Newton arithmetic mode. Callers may supply a
 * candidate explicitly; that candidate is kept distinct from detector truth
 * through `cardinality_source` provenance.
 *
 * Results remain numerical candidates. A Newton step minimum does not prove
 * closure, primitive period, stability, or uniqueness of an orbit.
 *
 * @param {{re:number|string,im:number|string}|{x:number|string,y:number|string}} point
 *   Mandelbrot parameter. Decimal strings are preserved in big-complex mode.
 * @param {{cardinality?:number,cardinality_source?:string,iterations?:number,
 *   maximum_detection_iterations?:number,minimum_return_repetitions?:number,
 *   adaptive_detection?:boolean,newton_limit?:number,
 *   newton_mode?:"native"|"big_complex"|"both",precision_digits?:number}} [options]
 *   Detection, refinement, and provenance controls.
 * @returns {object} Detector evidence, candidate source, Newton points, and diagnostics.
 */
export default function FractoOrbitalPoints(point, options = {}) {
  const normalized_point = normalize_point(point);
  if (!normalized_point) {
    return {
      status: "invalid_input",
      point: { re: String(point?.re ?? point?.x ?? ""), im: String(point?.im ?? point?.y ?? "") },
      detection: { status: "invalid_input", candidate_cardinality: null },
      cardinality: null,
      cardinality_source: null,
      newton: null,
      diagnostics: { reason: "coordinates_must_be_finite_numbers" },
    };
  }
  if (
    !FractoUtil.point_in_main_cardioid({
      x: Number(normalized_point.re),
      y: Number(normalized_point.im),
    })
  ) {
    return FractoFastCalc.calc(
      Number(normalized_point.re),
      Number(normalized_point.im),
    );
  }

  const has_supplied_cardinality = options.cardinality !== undefined &&
    options.cardinality !== null;
  let detection = null;
  let cardinality;
  let cardinality_source;
  let detector_result = null;

  if (has_supplied_cardinality) {
    cardinality = Number(options.cardinality);
    cardinality_source = options.cardinality_source || "caller_supplied";
    if (!Number.isInteger(cardinality) || cardinality < 1) {
      return {
        status: "invalid_cardinality",
        point: normalized_point,
        detection: null,
        cardinality: null,
        cardinality_source,
        newton: null,
        diagnostics: { reason: "cardinality_must_be_a_positive_integer" },
      };
    }
  } else {
    detector_result = FractoCardinality(normalized_point, options);
    detection = detector_result.detection;
    if (detector_result.status !== "cardinality_detected") {
      const { samples: _samples, ...detector } = detector_result;
      return {
        ...detector,
        status: detector_result.status,
        detection,
        cardinality: null,
        cardinality_source: "sdk_critical_orbit_return_detector",
        newton_native: null,
        newton_big_complex: null,
        newton: null,
      };
    }
    cardinality = detection.candidate_cardinality;
    cardinality_source = "sdk_critical_orbit_return_detector";
  }

  const newton_limit = Math.max(1, Math.floor(Number(options.newton_limit) || 10));
  const newton_mode = options.newton_mode || "big_complex";
  if (!["native", "big_complex", "both"].includes(newton_mode)) {
    return {
      status: "invalid_newton_mode",
      point: normalized_point,
      detection,
      cardinality,
      cardinality_source,
      newton: null,
      diagnostics: { reason: "newton_mode_must_be_native_big_complex_or_both" },
    };
  }
  const precision_digits = Math.min(
    512,
    Math.max(16, Math.floor(Number(options.precision_digits) || 64)),
  );
  const big_solver_point = {
    x: normalized_point.re,
    y: normalized_point.im,
  };
  const native_solver_point = {
    x: Number(normalized_point.re),
    y: Number(normalized_point.im),
  };
  const response = {
    status: "cardinality_passed_to_newton",
    point: normalized_point,
    ...(detector_result
      ? {
          domain: detector_result.domain,
          iterations: detector_result.iterations,
          escaped: detector_result.escaped,
          diagnostics: detector_result.diagnostics,
        }
      : {}),
    detection,
    cardinality,
    cardinality_source,
    newton_native: null,
    newton_big_complex: null,
    newton: null,
  };

  if (newton_mode === "native" || newton_mode === "both") {
    response.newton_native = with_diagnostics(
      newton_derived(native_solver_point, newton_limit, cardinality),
      "native",
      cardinality,
      cardinality_source,
      15,
    );
  }
  if (newton_mode === "big_complex" || newton_mode === "both") {
    response.newton_big_complex = with_diagnostics(
      newton_big_complex(big_solver_point, newton_limit, cardinality, {
        precision_digits,
      }),
      "big_complex",
      cardinality,
      cardinality_source,
      precision_digits,
    );
  }
  response.newton = newton_mode === "native"
    ? response.newton_native
    : newton_mode === "big_complex"
      ? response.newton_big_complex
      : null;
  return response;
}

export { FractoOrbitalPoints };
