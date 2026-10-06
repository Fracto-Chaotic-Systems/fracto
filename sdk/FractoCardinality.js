import FractoUtil from "./FractoUtil.js";
import FractoFastCalc from "./FractoFastCalc.js";
import { sample_critical_orbit } from "./orbitals/FractoOrbitSampling.js";
import { detect_return_cardinality } from "./orbitals/FractoReturnDetection.js";
import { has_sufficient_cardinality_evidence } from "./orbitals/FractoCardinalityQuality.js";

const DEFAULT_ITERATIONS = 4096;
const MAX_ITERATIONS = 262144;

const normalize_iterations = (value, fallback) =>
  Math.min(
    MAX_ITERATIONS,
    Math.max(1, Math.floor(Number(value) || fallback)),
  );

/**
 * Return Fracto's best current critical-orbit return-cardinality assessment
 * for a point in the main cardioid. Results are numerical candidates, not
 * mathematical proofs. The result includes the evidence and complete set of
 * detector horizons so downstream code can preserve provenance.
 *
 * This is the one public entry point for production cardinality detection.
 * Optional competing estimates (for example a legacy calculator's period)
 * must be carried separately by callers and must not silently replace this
 * result.
 *
 * @param {{re:number|string,im:number|string}|{x:number|string,y:number|string}} point
 *   Mandelbrot parameter.
 * @param {{iterations?:number,maximum_detection_iterations?:number,
 *   minimum_return_repetitions?:number,adaptive_detection?:boolean}} [options]
 *   Bounded detector controls. Adaptive detection is enabled by default.
 * @returns {object} Candidate cardinality, evidence, and diagnostics.
 */
export default function FractoCardinality(point, options = {}) {
  const raw_re = point?.re ?? point?.x;
  const raw_im = point?.im ?? point?.y;
  const re = Number(raw_re);
  const im = Number(raw_im);
  if (!Number.isFinite(re) || !Number.isFinite(im)) {
    return {
      status: "invalid_input",
      point: { re: String(raw_re ?? ""), im: String(raw_im ?? "") },
      iterations: 0,
      escaped: false,
      samples: [],
      detection: {
        status: "invalid_input",
        candidate_cardinality: null,
      },
      diagnostics: { reason: "coordinates_must_be_finite_numbers" },
    };
  }

  const normalized_point = { re: String(raw_re), im: String(raw_im) };
  const domain = FractoUtil.point_in_main_cardioid({ x: re, y: im })
    ? "main_cardioid"
    : "outside_main_cardioid";
  if (domain === "outside_main_cardioid") {
    return FractoFastCalc.calc(re, im);
  }

  const base_iterations = normalize_iterations(
    options.iterations,
    DEFAULT_ITERATIONS,
  );
  const maximum_detection_iterations = Math.max(
    base_iterations,
    normalize_iterations(
      options.maximum_detection_iterations,
      MAX_ITERATIONS,
    ),
  );
  const adaptive_detection = options.adaptive_detection !== false;
  const checked_horizons = [];
  let horizon = base_iterations;
  let orbit;
  let detection;

  while (true) {
    orbit = sample_critical_orbit(normalized_point, { iterations: horizon });
    detection = detect_return_cardinality(orbit.samples, {
      minimum_return_repetitions: options.minimum_return_repetitions,
    });
    checked_horizons.push(horizon);
    if (
      !adaptive_detection ||
      orbit.escaped ||
      has_sufficient_cardinality_evidence(
        { detection },
        horizon,
      ) ||
      horizon >= maximum_detection_iterations
    ) {
      break;
    }
    horizon = Math.min(maximum_detection_iterations, horizon * 2);
  }

  return {
    point: normalized_point,
    domain,
    iterations: orbit.iterations,
    escaped: orbit.escaped,
    samples: orbit.samples,
    detection,
    status:
      detection.status === "return_pattern_detected" &&
      Number.isInteger(detection.candidate_cardinality)
        ? "cardinality_detected"
        : "cardinality_inconclusive",
    diagnostics: {
      detector: "critical_orbit_return",
      domain,
      adaptive_detection,
      maximum_detection_iterations,
      checked_horizons,
      evidence_gate_passed: has_sufficient_cardinality_evidence(
        { detection },
        horizon,
      ),
      mathematical_proof: false,
    },
  };
}
