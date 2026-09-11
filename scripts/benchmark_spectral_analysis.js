import { performance } from "node:perf_hooks";
import {
  analyze_multi_polar_spectrum,
  analyze_polar_spectrum,
  DEFAULT_MULTI_ANALYSIS_CONFIGS,
} from "../servers/fracto-data-server/handlers/orbitals/spectral_analysis.js";

const ITERATIONS = 4096;
const RUNS = 5;
const samples = Array.from({ length: ITERATIONS + 1 }, (_, index) => ({
  iteration: index,
  theta: 2 * Math.PI * 0.013 * index,
  radius: 1,
}));

const measure = (callback) => {
  const started = performance.now();
  callback();
  return performance.now() - started;
};

// Warm the JIT before collecting timings.
measure(() => analyze_polar_spectrum(samples, 1));
measure(() =>
  analyze_multi_polar_spectrum(samples, 1, DEFAULT_MULTI_ANALYSIS_CONFIGS),
);

const single_pass_ms = [];
const multi_pass_ms = [];
for (let run = 0; run < RUNS; run += 1) {
  single_pass_ms.push(measure(() => analyze_polar_spectrum(samples, 1)));
  multi_pass_ms.push(
    measure(() =>
      analyze_multi_polar_spectrum(samples, 1, DEFAULT_MULTI_ANALYSIS_CONFIGS),
    ),
  );
}

const summarize = (values) => ({
  min_ms: Math.min(...values),
  average_ms: values.reduce((sum, value) => sum + value, 0) / values.length,
  max_ms: Math.max(...values),
});
const single = summarize(single_pass_ms);
const multi = summarize(multi_pass_ms);
console.log(`spectral analysis benchmark (${RUNS} runs)`);
console.log(`single: ${JSON.stringify(single)}`);
console.log(`multi:  ${JSON.stringify(multi)}`);
console.log(
  `relative cost: ${(multi.average_ms / Math.max(single.average_ms, 0.001)).toFixed(2)}x`,
);
