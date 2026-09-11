import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DEFAULT_DATA_URLS = ["http://127.0.0.1:3002", "http://127.0.0.1:3102"];
const CATEGORIES = [
  { name: "free", is_node: 0, is_inline: 0 },
  { name: "inline", is_node: 0, is_inline: 1 },
  { name: "nodal", is_node: 1, is_inline: 0 },
];

const parse_json = (value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const parse_point = (value) => {
  const point = parse_json(value);
  if (!point || typeof point !== "object") return null;
  const re = Number(point.re ?? point.x);
  const im = Number(point.im ?? point.y);
  return Number.isFinite(re) && Number.isFinite(im) ? { re, im } : null;
};

const usage = () => {
  console.log(
    "Usage: npm run data:orbital:detector:benchmark -- --sample-count 100 [options]",
  );
  console.log(
    "Options: --url URL --sample-count N --pool-limit N --iterations N --repetitions N --output FILE",
  );
};

const parse_args = (args) => {
  const options = {
    url: process.env.FRACTO_DATA_URL,
    sample_count: Number(process.env.FRACTO_DETECTOR_SAMPLE_COUNT || 100),
    pool_limit: Number(process.env.FRACTO_DETECTOR_POOL_LIMIT || 5000),
    iterations: Number(process.env.FRACTO_ORBITAL_ITERATIONS || 4096),
    repetitions: Number(process.env.FRACTO_RETURN_REPETITIONS || 5),
    output: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const [key, inline_value] = argument.split("=", 2);
    const value_for = () => inline_value ?? args[++index];
    if (key === "--help" || key === "-h") {
      usage();
      process.exit(0);
    }
    if (key === "--url") options.url = value_for();
    else if (key === "--sample-count")
      options.sample_count = Number(value_for());
    else if (key === "--pool-limit") options.pool_limit = Number(value_for());
    else if (key === "--iterations") options.iterations = Number(value_for());
    else if (key === "--repetitions") options.repetitions = Number(value_for());
    else if (key === "--output") options.output = value_for();
    else throw new Error(`Unknown argument "${argument}"`);
  }
  for (const [name, value] of Object.entries({
    sample_count: options.sample_count,
    pool_limit: options.pool_limit,
    iterations: options.iterations,
  })) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(
        `--${name.replaceAll("_", "-")} must be a positive integer`,
      );
    }
  }
  if (!Number.isInteger(options.repetitions) || options.repetitions < 5) {
    throw new Error("--repetitions must be an integer of at least 5");
  }
  return options;
};

const find_data_server = async (configured_url) => {
  const candidates = configured_url ? [configured_url] : DEFAULT_DATA_URLS;
  for (const candidate of candidates) {
    try {
      const response = await fetch(`${candidate}/`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return candidate;
    } catch (error) {
      if (configured_url) throw error;
    }
  }
  throw new Error("No local data server is reachable; start port 3002 or 3102");
};

const shuffled = (records) => {
  const result = [...records];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
};

const load_candidates = async (base_url, limit) => {
  const records = [];
  for (const category of CATEGORIES) {
    const params = new URLSearchParams({
      is_node: category.is_node,
      is_inline: category.is_inline,
      limit,
    });
    const response = await fetch(`${base_url}/minibrots?${params}`);
    const body = await response.json();
    if (!response.ok) {
      throw new Error(
        body.error || `free_bailiwicks request failed (${response.status})`,
      );
    }
    for (const record of body.result || []) {
      // The detector must always test the stored core point. Display settings
      // describe a rendering view and are intentionally never used here.
      const core_point = parse_point(record.core_point);
      const expected = Number(record.pattern);
      if (core_point && Number.isInteger(expected) && expected > 0) {
        records.push({
          id: record.id,
          category: category.name,
          point_source: "core_point",
          ...core_point,
          expected,
        });
      }
    }
  }
  return records;
};

const request_detection = async (base_url, record, options) => {
  const url = new URL("/orbital_spectrum", base_url);
  url.searchParams.set("re", record.re);
  url.searchParams.set("im", record.im);
  url.searchParams.set("iterations", options.iterations);
  url.searchParams.set("minimum_return_repetitions", options.repetitions);
  url.searchParams.set("detection_mode", "returns");
  const started = performance.now();
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  // Accept the direct endpoint response and the `{ result: ... }` envelope
  // used by older server wrappers during rolling container upgrades.
  const payload = body.detection ? body : body.result || body.data || body;
  const detection = payload.detection;
  const detected = Number(detection?.candidate_cardinality);
  return {
    ...record,
    detected: Number.isInteger(detected) ? detected : null,
    status: detection?.status || "unexpected_response_shape",
    response_keys: Object.keys(body),
    elapsed_ms: performance.now() - started,
  };
};

const options = parse_args(process.argv.slice(2));
const data_url = await find_data_server(options.url);
const all_candidates = await load_candidates(data_url, options.pool_limit);
if (all_candidates.length < options.sample_count) {
  throw new Error(
    `Only ${all_candidates.length} usable free_bailiwicks records were returned`,
  );
}
const selected = shuffled(all_candidates).slice(0, options.sample_count);
console.log(`Testing ${selected.length} random free_bailiwicks records`);
const results = [];
for (const [index, record] of selected.entries()) {
  const result = await request_detection(data_url, record, options);
  console.log(
    `${index + 1}/${selected.length} ${record.category} #${record.id} (${record.point_source}): expected ${record.expected}, detected ${result.detected ?? "inconclusive"}`,
  );
  results.push(result);
}
const valid = results.filter((result) => result.detected !== null);
const matches = valid.filter((result) => result.detected === result.expected);
const inconclusive = results.filter(
  (result) => result.status === "inconclusive",
);
const unexpected = results.filter(
  (result) => result.status === "unexpected_response_shape",
);
const report = {
  generated_at: new Date().toISOString(),
  data_url,
  options,
  pool_size: all_candidates.length,
  sample_size: results.length,
  summary: {
    detected: valid.length,
    inconclusive: inconclusive.length,
    unexpected_response: unexpected.length,
    matches: matches.length,
    accuracy: valid.length ? matches.length / valid.length : null,
    total_elapsed_ms: results.reduce(
      (sum, result) => sum + result.elapsed_ms,
      0,
    ),
  },
  results,
};
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const output_file = options.output
  ? path.resolve(ROOT_DIR, options.output)
  : path.join(
      ROOT_DIR,
      "servers",
      "fracto-data-server",
      "benchmarks",
      "orbital-detector",
      `detector-${timestamp}.json`,
    );
await mkdir(path.dirname(output_file), { recursive: true });
await writeFile(output_file, JSON.stringify(report, null, 2));
console.log(
  `Matched ${matches.length}/${results.length}; wrote ${path.relative(ROOT_DIR, output_file)}`,
);
const mismatches = results.filter(
  (result) => result.detected !== result.expected,
);
if (mismatches.length) {
  console.log(`Non-matching cases (${mismatches.length}):`);
  for (const result of mismatches) {
    console.log(
      `  ${result.category} #${result.id} (${result.re}, ${result.im}): expected ${result.expected}, detected ${result.detected ?? "inconclusive"} [${result.status}; ${result.elapsed_ms.toFixed(1)}ms]`,
    );
  }
} else {
  console.log("Non-matching cases: none");
}
