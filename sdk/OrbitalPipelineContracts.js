/**
 * Shared data contracts for the orbital-to-audio pipeline.
 *
 * These definitions are intentionally transport-neutral. The data server may
 * produce the objects, while the UI or another client may consume them without
 * importing any handler or React implementation. Every stage should accept
 * only the fields it needs and preserve the fields it does not own.
 */

/**
 * A finite complex coordinate in the canonical application representation.
 * @typedef {{re: number, im: number}} ComplexPoint
 */

/**
 * A focal point supplied to the detector pipeline.
 * @typedef {ComplexPoint} FocalPoint
 */

/**
 * A point belonging to the detected/refined periodic orbit.
 * @typedef {ComplexPoint} OrbitalPoint
 */

/**
 * One sample on a parameterized orbital curve.
 * `t` is the parameter used by the interpolation scheme; `C` is the complex
 * location at that parameter.
 * @typedef {{t: number, C: ComplexPoint}} CurveSample
 */

/**
 * A curve sample augmented with its distance from Q and an optional normalized
 * audio value. `audio_value` is centered and constrained to [-1, 1].
 * @typedef {{t: number, C: ComplexPoint, value: number, audio_value?: number}} WaveformSample
 */

/**
 * The common result envelope exchanged between pipeline stages and transport
 * adapters. Stages may return a partial envelope while adding their fields.
 * @typedef {object} OrbitalPipelineResult
 * @property {FocalPoint} focal_point Original input point P.
 * @property {ComplexPoint|null} Q Cardioid-root/origin used by radial sweep
 *   and distance-based waveform construction.
 * @property {number|null} cardinality Detected number of orbital points.
 * @property {OrbitalPoint[]} orbital_points Ordered periodic orbit points.
 * @property {CurveSample[]} curve_samples Parameterized curve samples.
 * @property {WaveformSample[]} waveform_profile Distance/audio samples derived
 *   from the curve.
 * @property {object} [detector] Detector diagnostics and provenance.
 * @property {object} [newton] Newton refinement diagnostics.
 * @property {number} [elapsed_ms] Stage or complete-pipeline elapsed time.
 */

/** Increment when the shape or meaning of these contracts changes. */
export const ORBITAL_PIPELINE_CONTRACT_VERSION = 1;

/**
 * Convert the common `{x, y}` or `{re, im}` forms to a canonical point.
 * This is a boundary helper; internal pipeline stages should use `{re, im}`.
 *
 * @param {object|null|undefined} point Candidate point.
 * @returns {ComplexPoint|null} Canonical finite point, or null if invalid.
 */
export const to_complex_point = (point) => {
  if (!point) {
    return null;
  }
  const re = Number(point.re ?? point.x);
  const im = Number(point.im ?? point.y);
  return Number.isFinite(re) && Number.isFinite(im) ? { re, im } : null;
};

/**
 * Test whether a value conforms to the canonical complex-point contract.
 *
 * @param {unknown} point Value to inspect.
 * @returns {boolean} True for a finite `{re, im}` point.
 */
export const is_complex_point = (point) =>
  Boolean(
    point &&
      Number.isFinite(Number(point.re)) &&
      Number.isFinite(Number(point.im)),
  );
