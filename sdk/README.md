# Fracto SDK

Shared JavaScript utilities for Fracto's fractal calculations, coordinate handling, coloring, tile discovery, caching, and rendering data.

The SDK is defined as the `@fracto/sdk` package in this repository. It uses ES
modules and exposes a stable barrel entry point plus explicit `.js` subpaths.

During the local-development transition, direct file imports remain supported.
Consumers should eventually prefer package imports:

```js
import { FractoCanvasBuffer } from "@fracto/sdk";
import FractoFastCalc from "@fracto/sdk/FractoFastCalc.js";
```

```js
import Complex from "./sdk/math/Complex.js";
import FractoFastCalc from "./sdk/FractoFastCalc.js";

const point = new Complex(-0.75, 0.1);
const result = FractoFastCalc.calc(point.re, point.im);
```

## Modules

### Calculation and math

- `FractoFastCalc.js` performs fast Mandelbrot-set and orbit calculations.
  Its established `calc(re, im, level)` continues to iterate from `z=0`.
  The separate experimental `calc_from_seed(re, im, seed_re, seed_im, level)`
  uses the supplied initial orbit point without changing `calc()`.
  `calc_big_complex_from_seed(re, im, seed_re, seed_im, options)` is another
  isolated experimental path for high-precision seed surveys. It keeps the
  coordinates in BigComplex/Decimal arithmetic, reports candidate cycles,
  escapes, unresolved runs, or numerical failures, and returns decimal-string
  orbit points. Its precision, iteration cap, transient, and recurrence
  tolerance are explicit settings. It recognizes slow one-point convergence
  from successive-step and fixed-point residuals, although the survey
  intentionally omits singleton results from its dots. A repeated state
  within tolerance is a finite-precision candidate, not proof of an exact
  cycle. Neither seeded method changes the behavior of `calc()`.
- `FractoCardinality.js` is the single production entry point for best-known
  orbit return-cardinality detection inside the main cardioid. By default it
  uses the critical orbit from `z=0`; callers may pass `options.seed` as a
  complex `{re, im}` (or `{x, y}`) value to detect from another initial point.
  Results record the selected seed and detector method. It
  returns the candidate, evidence, bounded adaptive horizons, and an explicit
  non-proof status. Outside the main cardioid it returns `FractoFastCalc.calc()`
  directly without running the detector, unless `options.seed` is supplied;
  with a seed it returns `FractoFastCalc.calc_from_seed()` instead. Set
  `options.seed_level` to bound that fallback calculator's work. Consumers import
  `@fracto/sdk/FractoCardinality.js` or the named `FractoCardinality` barrel
  export.
- `FractoOrbitalPoints.js` provides the common detector-to-Newton interface.
  It uses `FractoCardinality` by default or accepts an explicitly sourced
  cardinality candidate, recording that source in its result. Newton outputs
  are numerical candidates, not closure or stability proofs. Native and
  BigComplex modes remain selectable for comparison; the BigComplex mode
  preserves decimal input coordinates and performs the Newton quotient with
  decimal arithmetic. Outside the main cardioid it returns
  `FractoFastCalc.calc()` directly, even if a caller supplied a cardinality.
- `orbitals/FractoNewtonDerived.js` and
  `orbitals/FractoNewtonBigComplex.js` contain the SDK's Newton solver
  implementations. The data server's corresponding modules are compatibility
  re-exports; callers should use `FractoOrbitalPoints` for unified provenance
  and result structure.
- `orbitals/FractoOrbitSampling.js` and
  `orbitals/FractoReturnDetection.js` contain the sampler and return detector
  used internally by `FractoCardinality`; data-server compatibility modules
  re-export these same implementations.
- `FractoHyperCalc.js` and `FractoHyperComplexCalc.js` provide higher-iteration calculation strategies.
- `FractoBigNumber.js` supports high-precision numeric calculations.
- `FractoProjection.js` calculates projections for complex-plane points.
- `FractoUtil.js` contains shared fractal and coordinate helpers, including
  validated conversions between upper main-cardioid points and multiplier
  polar coordinates `(r, theta)`. The inverse conversion rejects points
  outside the closed cardioid or below the real axis; `theta` is a real turn
  fraction in `[0, 1/2]`, not necessarily rational. `r_theta_to_P()` validates
  the coordinate range, while the older `P_from_r_theta()` remains available
  for compatibility.
- `math/Complex.js`, `math/BigComplex.js`, and `math/HyperComplex.js` implement the numeric types used by the calculators.
- `math/utils.js` contains supporting math utilities, including Farey sequence generation.

### Orbital detection and refinement

`FractoCardinality` and `FractoOrbitalPoints` are the public, main-cardioid
entry points. Use them in order when both a candidate and refined points are
needed; use `FractoCardinality` alone when only candidate detection is needed.
The low-level Newton solvers accept a supplied period and do not search for
cardinality.

```js
import FractoCardinality from "@fracto/sdk/FractoCardinality.js";
import FractoOrbitalPoints from "@fracto/sdk/FractoOrbitalPoints.js";

const focal_point = {
  re: "0.22068356910785347",
  im: "0.24323356211767094",
};

const detected = FractoCardinality(focal_point);
if (detected.status === "cardinality_detected") {
  const refined = FractoOrbitalPoints(focal_point, {
    cardinality: detected.detection.candidate_cardinality,
    cardinality_source: "sdk_critical_orbit_return_detector",
    newton_mode: "big_complex",
    precision_digits: 128,
  });
  // Inspect refined.newton_big_complex.point_list and validate the cycle.
}
```

For a valid point outside the main cardioid, either entry point returns
`FractoFastCalc.calc(re, im)` directly. It does not return the normal orbital
envelope in that branch; the calculator's `{ pattern, iteration, ... }` result
shape is preserved, and Newton is skipped even if a period was supplied.
Invalid coordinates return an `invalid_input` envelope.

Within the cardioid, `FractoCardinality` samples the critical orbit from zero
unless `options.seed` supplies another initial complex value, then detects
repeated gaps between local minima. Pass a seed as
`{ seed: { re: "0.25", im: "-0.125" } }` or `{ seed: { x: 0.25, y: -0.125 } }`.
The result includes the actual starting seed and marks the detector as
`seeded_orbit_return` or `critical_orbit_return`. Omitting `seed` preserves
the existing zero-start behavior. The default horizon begins at
4,096 iterations and adaptively doubles up to 262,144 until the heuristic
evidence gate passes or the cap is reached. `iterations`,
`maximum_detection_iterations`, `minimum_return_repetitions`, and
`adaptive_detection` can bound or control this work. A successful result means
`cardinality_detected`; `detection.candidate_cardinality` is still a numerical
candidate, and `detection.ambiguous` can remain true even when a candidate is
returned. Recurrence gaps can be distorted by finite-precision stagnation,
particularly when a critical orbit approaches an attracting fixed point.
Neither the candidate nor a zero recurrence error proves a primitive period.

`FractoOrbitalPoints` detects a candidate by default or accepts a positive
integer `cardinality` supplied by its caller. `cardinality_source` records that
provenance. Its `newton_mode` is `native`, `big_complex` (default), or `both`;
`precision_digits` controls BigComplex arithmetic up to 512 digits, while
`newton_limit` bounds Newton cycles. Decimal coordinate strings are preserved
in the BigComplex solver. Both Newton solvers start their root guess at zero,
so they can converge to a lower-period root such as the attracting fixed point
even when a larger period was supplied. Repeated points and zero Newton step
must not be treated as confirmation of the requested period. Check the number
of distinct points, closure, and primitive period independently. More
arithmetic precision can reduce rounding but cannot change a Newton basin or
restore coordinate digits that were already lost before string input.

Direct SDK results retain detailed samples and diagnostics for analysis. The
data-server `/orbital_newton` HTTP response is deliberately smaller and omits
large detector arrays and detailed solver evidence; it is not a serialization
of the complete SDK result.

### Color and tile data

- `FractoColors.js` converts iteration and pattern data into display colors.
- `FractoCanvasBuffer.js` converts iteration and pattern buffers into pixels
  on a canvas-like 2D context. It supports scale, heat-map, and selected-level
  arguments without depending on React, application settings, or a backend.
- Server-oriented tile, cache, coverage, and stream modules remain available
  through explicit subpath imports; they are intentionally not loaded by the
  browser-safe root entry point.
- `FractoIndexedTiles.js` defines tile-set names and retrieves indexed tile information.
- `FractoCoverageUtils.js` initializes and queries tile coverage.
- `FractoTileData.js` loads manifests and packets, selects tiles in scope, and fills raster buffers.
- `FractoTileCache.js` retrieves and manages tile files. Remote-cache mode
  uses the configured HTTP tile origin and local disk cache; local-source mode
  reads from the mounted filesystem and does not load that network
  configuration. Remote mode accepts `FRACTO_TILE_REMOTE_BASE_URL` as an
  optional override before falling back to `config/network.json`.
- `FractoIndexedTiles.js` loads tile short-code CSV listings. Local-source mode
  streams them from `FRACTO_TILE_SOURCE_DIR/manifest/` (including `indexed`,
  `interior`, and `blank` listings); remote-cache mode retains the configured
  HTTP listing source. Both paths currently materialize the parsed short codes
  for the callback API. A remote fetch or CSV-stream error marks the process
  unsuccessful so a tile-index refresh cannot publish an empty generation.
- `FractoTileSource.js` resolves and decodes authoritative tiles from a local
  `L<two-digit-level>/<short-code>.gz` source tree and validates the paired
  release manifest for local-source deployments. New schema-3 manifests bind
  the configured source generation to the compiled index fingerprint and a
  representative tile check; legacy schema-2 exact-inventory manifests remain
  supported. Other missing or invalid tiles are handled when requested.
- `FractoTileIndexCache.js` builds, validates, and loads the compiled tile-index cache used at startup. Local-source index metadata also records its paired source-generation identifier.
- `utils/StreamJson.js` streams JSON data from disk.

### Orbital pipeline contracts

- `OrbitalPipelineContracts.js` defines the transport-neutral vocabulary shared
  by orbital detection, Newton refinement, curve interpolation, waveform
  construction, and audio playback.

The canonical complex-point shape is `{ re, im }`. A `CurveSample` is
`{ t, C }`, where `C` is a complex point. A `WaveformSample` adds `value`, the
distance from `Q`, and may add a normalized `audio_value` in the range `[-1, 1]`.
The optional `OrbitalPipelineResult` envelope carries `focal_point`, `Q`,
`cardinality`, `orbital_points`, `curve_samples`, `waveform_profile`, and
diagnostic metadata. `to_complex_point()` is available only at input
boundaries to normalize legacy `{ x, y }` values; internal stages should use
`{ re, im }` consistently.

## Runtime considerations

The modules under `math/`, along with the core calculation and color utilities, are mostly self-contained. Tile and data modules depend on repository configuration, files under `tiles/`, Node.js filesystem APIs, or network access. They should be used from the Fracto repository root with project dependencies installed.

Some modules provide both named and default exports. Follow the exports in the
individual source file. `index.js` is the browser-safe root barrel; Node
consumers can also import explicit `.js` subpaths.

## Validation

From the repository root, run:

```powershell
npm run check
```

This checks JavaScript syntax across the SDK and runs the math test suite.
