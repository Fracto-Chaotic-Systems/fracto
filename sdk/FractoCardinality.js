import FractoUtil from "./FractoUtil.js";
import FractoFastCalc from "./FractoFastCalc.js";
import { sample_orbit } from "./orbitals/FractoOrbitSampling.js";
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
 * Return Fracto's best current orbit return-cardinality assessment for a
 * point in the main cardioid. By default, the orbit starts at z=0; callers
 * may provide `options.seed` to start at another complex value. Results are
 * numerical candidates, not
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
 * @param {{seed?:{re:number|string,im:number|string}|{x:number|string,y:number|string},
 *   seed_level?:number,seed_iteration_limit?:number,
 *   iterations?:number,maximum_detection_iterations?:number,
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
  const has_seed = options.seed !== undefined;
  const raw_seed_re = has_seed ? options.seed?.re ?? options.seed?.x : 0;
  const raw_seed_im = has_seed ? options.seed?.im ?? options.seed?.y : 0;
  const seed_re = Number(raw_seed_re);
  const seed_im = Number(raw_seed_im);
  if (!Number.isFinite(seed_re) || !Number.isFinite(seed_im)) {
    return {
      status: "invalid_input",
      point: normalized_point,
      seed: { re: String(raw_seed_re ?? ""), im: String(raw_seed_im ?? "") },
      iterations: 0,
      escaped: false,
      samples: [],
      detection: { status: "invalid_input", candidate_cardinality: null },
      diagnostics: { reason: "seed_coordinates_must_be_finite_numbers" },
    };
  }
  const normalized_seed = { re: String(raw_seed_re), im: String(raw_seed_im) };
  const domain = FractoUtil.point_in_main_cardioid({ x: re, y: im })
    ? "main_cardioid"
    : "outside_main_cardioid";
  if (domain === "outside_main_cardioid") {
    if (!has_seed) return FractoFastCalc.calc(re, im);
    if (options.seed_iteration_limit !== undefined) {
      return FractoFastCalc.calc_from_seed(
        re,
        im,
        seed_re,
        seed_im,
        options.seed_level,
        options.seed_iteration_limit,
      );
    }
    return options.seed_level === undefined
      ? FractoFastCalc.calc_from_seed(re, im, seed_re, seed_im)
      : FractoFastCalc.calc_from_seed(re, im, seed_re, seed_im, options.seed_level);
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
    orbit = sample_orbit(normalized_point, {
      iterations: horizon,
      seed: { re: seed_re, im: seed_im },
    });
    checked_horizons.push(horizon);
    if (orbit.escaped) {
      detection = {
        status: "orbit_escaped",
        candidate_cardinality: null,
        alternatives: [],
        ambiguous: false,
      };
      break;
    }
    detection = detect_return_cardinality(orbit.samples, {
      minimum_return_repetitions: options.minimum_return_repetitions,
      contiguous_iterations: true,
    });
    if (
      !adaptive_detection ||
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
    seed: normalized_seed,
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
      detector: has_seed ? "seeded_orbit_return" : "critical_orbit_return",
      seed_strategy: has_seed ? "caller_supplied" : "critical_zero",
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
