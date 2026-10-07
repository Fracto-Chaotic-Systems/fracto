# SDK orbital calculation helpers

This folder contains the numerical building blocks used by the public
`FractoCardinality` and `FractoOrbitalPoints` interfaces. These helpers are
kept separate so sampling, candidate scoring, and Newton refinement can be
tested independently. Application code should use the public SDK interfaces
instead of combining these internal stages itself.

Both public SDK entry points are scoped to the main cardioid. When a valid
parameter is outside that domain, `FractoCardinality` and
`FractoOrbitalPoints` return `FractoFastCalc.calc(re, im)` directly. The
cardinality detector and Newton solvers are skipped; the calculator's result
shape is preserved as-is. `FractoCardinality` also returns that result by
default outside the cardioid, but uses `calc_from_seed()` there when an
explicit seed is provided.

- `FractoOrbitSampling.js` iterates an orbit from a configurable complex seed
  for a bounded horizon and retains the samples used by return detection.
  Escaping samples stop at the radius-2 bailout when valid for the parameter,
  and report the actual iteration count rather than the configured horizon.
  `sample_critical_orbit()` remains a zero-seed wrapper for compatibility.
- `FractoReturnDetection.js` identifies repeated near-origin return gaps and
  provides the separate derivative-pyramid candidate sieve. The latter is
  experimental; neither method proves a mathematical period.
  Cardinality passes contiguous iteration metadata from its sampler so the
  detector can index samples directly and select recurrence medians without
  sorting; standalone detector calls retain support for arbitrary iteration
  labels.
- `FractoCardinalityQuality.js` evaluates whether a return candidate has
  enough repeated-gap evidence to stop adaptive horizon growth.
- `FractoNewtonDerived.js` refines a supplied cardinality with JavaScript
  `Number` arithmetic.
- `FractoNewtonBigComplex.js` refines a supplied cardinality with `BigComplex`
  arithmetic and configurable significant-digit precision.

The Newton solvers require a positive integer candidate and never search
cardinalities themselves. `FractoOrbitalPoints.js` obtains the default
candidate from `FractoCardinality` or records the source when a caller passes
an explicit candidate. Both Newton methods initialize their Newton root guess
at zero; this is a starting guess for solving the supplied-period equation,
not a cardinality detector or a claim that ordinary zero-based orbit
iteration reveals the sought orbital. The returned points and least Newton
step are numerical evidence, not proof of closure, primitive period, or
stability.

Return-detection results include `pyramid_layer_diagnostics` for the winning
candidate and each reported alternative. Each finite-difference order reports
its scale, minimum/maximum/mean absolute change, absolute and normalized
spread, noise threshold, counts of positive/negative/ignored changes, summed
positive/negative change magnitudes, and magnitude-weighted directional
coherence. Per-layer coherence is `abs(positive_magnitude -
negative_magnitude) / (positive_magnitude + negative_magnitude)`; a
zero-magnitude layer scores 1 because it has no measurable directional
conflict. The aggregate `pyramid_magnitude_coherence` is the mean of those
per-layer values, while
`pyramid_minimum_layer_magnitude_coherence` preserves the weakest layer. Both
now inform the ambiguity and adaptive stopping rules. The prior
`pyramid_coherence`, `pyramid_sign_changes`, and `legacy_ambiguous` values
remain available for comparison; the existing `confidence` composite also
continues to use the raw sign-only coherence. The `0.5` and `0.9` cutoffs
remain heuristic, and a passing gate is not proof of a mathematical orbit.
