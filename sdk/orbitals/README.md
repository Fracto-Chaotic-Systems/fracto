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
  labels. The return detector keeps numeric scratch buffers local to each
  invocation and reuses them across recurrence-median selections and all
  candidate derivative pyramids. Candidate ranking, diagnostic calculations,
  and returned detail remain unchanged. No mutable scratch state is shared
  between concurrent detector calls.
- `FractoCardinalityQuality.js` evaluates whether a return candidate has
  enough repeated-gap evidence to stop adaptive horizon growth.
- `FractoNewtonDerived.js` refines a supplied cardinality with JavaScript
  `Number` arithmetic.
- `FractoNewtonBigComplex.js` refines a supplied cardinality with `BigComplex`
  arithmetic and configurable significant-digit precision.

## Return-detector scratch memory and performance

`detect_return_cardinality()` allocates its mutable numeric workspace at the
start of each detector call. The recurrence-error `Float64Array` is sized for
the largest tail window needed by that call; its active length is reset for
the baseline median and each candidate median. Three fixed-capacity arrays
hold the radius samples and alternating finite-difference layers for the
derivative pyramids. They are reused candidate by candidate, while each
candidate's returned diagnostic objects are newly created and retained.

The workspace is local to one synchronous detector invocation. It is not a
module-level singleton, is not shared across worker threads or concurrent
requests, and is discarded when the call returns. Adaptive horizon passes
and separate survey seeds each make their own detector call and workspace.
The output orbit samples, minima, matching-minima references, and diagnostic
records remain allocated because they are part of the returned result. The
change reduces temporary-array churn; it does not remove calculations, alter
candidate ranking, or reduce an iteration horizon.

A single-run comparison against the committed detector before this change was
measured on Windows with Node.js 22.19.0. Each implementation ran in a fresh
process; peak RSS was sampled before result hashing and includes Node's
runtime baseline. The survey payload and complete single-point result hashes
were identical between versions.

| Case                                     | Baseline | Scratch-buffer version | Peak RSS, baseline → version |
| ---------------------------------------- | -------: | ---------------------: | ---------------------------: |
| Stable survey seed, 4,096 iterations     |  31.1 ms |                27.4 ms |              52.7 → 52.1 MiB |
| Ambiguous survey seed, 4,096 iterations  |  34.7 ms |                28.9 ms |              52.9 → 52.7 MiB |
| Near-cusp case, adaptive through 262,144 | 139.4 ms |               128.4 ms |            120.4 → 114.1 MiB |
| 121×121 survey, 14,641 seeds             |   32.2 s |                 26.7 s |            134.1 → 131.4 MiB |

These are single-run observations, not statistically stable benchmarks. The
near-cusp case remained inconclusive at the same 262,144-iteration cap. The
survey retained the same 3,927 non-singleton candidates, 10,684 escaped seeds,
30 unresolved seeds, and confidence range. Repeat measurements under a
controlled system load before treating the observed speed or memory changes
as a general performance guarantee.

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
