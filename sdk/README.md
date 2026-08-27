# Fracto SDK

Shared JavaScript utilities for Fracto's fractal calculations, coordinate handling, coloring, tile discovery, caching, and rendering data.

The SDK is part of this repository rather than a separately published package. Import modules directly by file path. The project uses ES modules, so include the `.js` extension in imports.

```js
import Complex from './sdk/math/Complex.js'
import FractoFastCalc from './sdk/FractoFastCalc.js'

const point = new Complex(-0.75, 0.1)
const result = FractoFastCalc.calc(point.re, point.im)
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
- `FractoIndexedTiles.js` defines tile-set names and retrieves indexed tile information.
- `FractoCoverageUtils.js` initializes and queries tile coverage.
- `FractoTileData.js` loads manifests and packets, selects tiles in scope, and fills raster buffers.
- `FractoTileCache.js` retrieves and manages locally cached tile files.
- `FractoTileIndexCache.js` builds and loads the compiled tile-index cache used at startup.
- `utils/StreamJson.js` streams JSON data from disk.

## Runtime considerations

The modules under `math/`, along with the core calculation and color utilities, are mostly self-contained. Tile and data modules depend on repository configuration, files under `tiles/`, Node.js filesystem APIs, or network access. They should be used from the Fracto repository root with project dependencies installed.

Some modules provide both named and default exports. Follow the exports in the individual source file; there is no SDK barrel module.

## Validation

From the repository root, run:

```powershell
npm run check
```

This checks JavaScript syntax across the SDK and runs the math test suite.
