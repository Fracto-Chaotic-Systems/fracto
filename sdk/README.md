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
- `FractoHyperCalc.js` and `FractoHyperComplexCalc.js` provide higher-iteration calculation strategies.
- `FractoBigNumber.js` supports high-precision numeric calculations.
- `FractoProjection.js` calculates projections for complex-plane points.
- `FractoUtil.js` contains shared fractal and coordinate helpers.
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
- `FractoTileCache.js` retrieves and manages locally cached tile files.
- `FractoTileIndexCache.js` builds and loads the compiled tile-index cache used at startup.
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

Some modules provide both named and default exports. Follow the exports in the individual source file; there is no SDK barrel module.

## Validation

From the repository root, run:

```powershell
npm run check
```

This checks JavaScript syntax across the SDK and runs the math test suite.
