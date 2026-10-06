/**
 * Shared evidence gate for a bounded adaptive cardinality search. The
 * magnitude-weighted coherence retains raw sign-only coherence as a separate
 * diagnostic and discounts opposing changes in proportion to their sizes.
 * This is an internal SDK helper; public callers use FractoCardinality.
 * @param {object|undefined} result Detector result.
 * @param {number} horizon Number of observed iterations.
 * @returns {boolean} Whether detection evidence is sufficient to stop.
 */
export const has_sufficient_cardinality_evidence = (result, horizon) => {
  const detection = result?.detection;
  const cardinality = detection?.candidate_cardinality;
  const pyramid_magnitude_coherence = Number.isFinite(
    detection?.pyramid_magnitude_coherence,
  )
    ? detection.pyramid_magnitude_coherence
    : detection?.pyramid_coherence;
  const minimum_layer_magnitude_coherence = Number.isFinite(
    detection?.pyramid_minimum_layer_magnitude_coherence,
  )
    ? detection.pyramid_minimum_layer_magnitude_coherence
    : detection?.pyramid_coherence;
  return (
    detection?.status === "return_pattern_detected" &&
    Number.isInteger(cardinality) &&
    horizon >= cardinality * 10 &&
    pyramid_magnitude_coherence >= 0.9 &&
    minimum_layer_magnitude_coherence >= 0.5 &&
    detection.recurrence_quality >= 0.9 &&
    detection.confidence_margin >= 0.25 &&
    detection.ambiguous !== true
  );
};
