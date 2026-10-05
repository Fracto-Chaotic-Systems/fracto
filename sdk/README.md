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
- `FractoCardinality.js` is the single production entry point for best-known
  critical-orbit return-cardinality detection inside the main cardioid. It
  returns the candidate, evidence, bounded adaptive horizons, and an explicit
  non-proof status. Consumers import `@fracto/sdk/FractoCardinality.js` or the
  named `FractoCardinality` barrel export.
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
