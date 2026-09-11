import { performance } from "node:perf_hooks";
import { newton_derived } from "../servers/fracto-data-server/handlers/orbitals/newton_derived.js";
import { newton_big_complex } from "../servers/fracto-data-server/handlers/orbitals/newton_big_complex.js";

const CASES = [
  {
    name: "cardinality-7",
    point: { x: 0.1211937096, y: 0.6106129599 },
    cardinality: 7,
  },
  {
    name: "cardinality-65",
    point: { x: 0.1517440416, y: 0.5760073226 },
    cardinality: 65,
  },
];
const RUNS = 3;
const LIMIT = 1;
const INCLUDE_EXPENSIVE_BIG_LEGACY =
  process.env.FRACTO_INCLUDE_BIG_NEWTON_LEGACY === "true";

const measure = (callback) => {
  const original_log = console.log;
  console.log = () => {};
  const started = performance.now();
  try {
    callback();
  } finally {
    console.log = original_log;
  }
  return performance.now() - started;
};

const summarize = (values) => ({
  min_ms: Math.min(...values),
  average_ms: values.reduce((sum, value) => sum + value, 0) / values.length,
  max_ms: Math.max(...values),
});

for (const test_case of CASES) {
  console.log(`\n${test_case.name}`);
  for (const [mode, solver] of [
    ["native", newton_derived],
    ["big_complex", newton_big_complex],
  ]) {
    const known = [];
    const legacy = [];
    for (let run = 0; run < RUNS; run += 1) {
      known.push(
        measure(() => solver(test_case.point, LIMIT, test_case.cardinality)),
      );
      if (mode !== "big_complex" || INCLUDE_EXPENSIVE_BIG_LEGACY) {
        legacy.push(measure(() => solver(test_case.point, LIMIT)));
      }
    }
    const known_summary = summarize(known);
    console.log(`${mode} known:  ${JSON.stringify(known_summary)}`);
    if (legacy.length > 0) {
      const legacy_summary = summarize(legacy);
      console.log(`${mode} legacy: ${JSON.stringify(legacy_summary)}`);
      console.log(
        `${mode} speedup: ${(legacy_summary.average_ms / Math.max(known_summary.average_ms, 0.001)).toFixed(2)}x`,
      );
    } else {
      console.log(
        "big_complex legacy: skipped by default (set FRACTO_INCLUDE_BIG_NEWTON_LEGACY=true to enable)",
      );
    }
  }
}
