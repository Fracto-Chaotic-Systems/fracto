/**
 * Shared evidence gate for a bounded adaptive cardinality search.
 * This is an internal SDK helper; public callers use FractoCardinality.
 * @param {object|undefined} result Detector result.
 * @param {number} horizon Number of observed iterations.
 * @returns {boolean} Whether detection evidence is sufficient to stop.
 */
export const has_sufficient_cardinality_evidence = (result, horizon) => {
  const detection = result?.detection;
  const cardinality = detection?.candidate_cardinality;
  return (
    detection?.status === "return_pattern_detected" &&
    Number.isInteger(cardinality) &&
    horizon >= cardinality * 10 &&
    detection.pyramid_coherence >= 0.9 &&
    detection.recurrence_quality >= 0.9 &&
    detection.confidence_margin >= 0.25 &&
    detection.ambiguous !== true
  );
};
