import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DEFAULT_DATA_URLS = ["http://127.0.0.1:3002", "http://127.0.0.1:3102"];
const FAREY_PATH = path.join(
  ROOT_DIR,
  "servers",
  "fracto-data-server",
  "farey_sequence.csv",
);

const usage = () => {
  console.log(
    "Usage: npm run data:orbital:main-cardioid:benchmark -- --sample-count 100 [options]",
  );
  console.log(
    "Options: --url URL --sample-count N --r-min N --r-max N --iterations N --repetitions N --output FILE",
  );
};

const parse_args = (args) => {
  const options = {
    url: process.env.FRACTO_DATA_URL,
    sample_count: Number(process.env.FRACTO_CARDIOID_SAMPLE_COUNT || 100),
    r_min: Number(process.env.FRACTO_CARDIOID_R_MIN || 0.9),
    r_max: Number(process.env.FRACTO_CARDIOID_R_MAX || 1),
    iterations: Number(process.env.FRACTO_ORBITAL_ITERATIONS || 16384),
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
    else if (key === "--sample-count") options.sample_count = Number(value_for());
    else if (key === "--r-min") options.r_min = Number(value_for());
    else if (key === "--r-max") options.r_max = Number(value_for());
    else if (key === "--iterations") options.iterations = Number(value_for());
    else if (key === "--repetitions") options.repetitions = Number(value_for());
    else if (key === "--output") options.output = value_for();
    else throw new Error(`Unknown argument "${argument}"`);
  }
  if (!Number.isInteger(options.sample_count) || options.sample_count < 1) {
    throw new Error("--sample-count must be a positive integer");
  }
  if (!Number.isFinite(options.r_min) || !Number.isFinite(options.r_max)) {
    throw new Error("--r-min and --r-max must be finite numbers");
  }
  if (options.r_min < 0 || options.r_max > 1 || options.r_min > options.r_max) {
    throw new Error("r range must satisfy 0 <= r-min <= r-max <= 1");
  }
  if (!Number.isInteger(options.iterations) || options.iterations < 1) {
    throw new Error("--iterations must be a positive integer");
  }
  if (!Number.isInteger(options.repetitions) || options.repetitions < 2) {
    throw new Error("--repetitions must be an integer of at least 2");
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

const load_farey = async () => {
  const text = await readFile(FAREY_PATH, "utf8");
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [num, den, ratio] = line.split(",").map(Number);
      return { num, den, ratio };
    })
    .filter(({ num, den, ratio }) =>
      Number.isInteger(num) &&
      Number.isInteger(den) &&
      den >= 3 &&
      Number.isFinite(ratio),
    );
};

const shuffled = (records) => {
  const result = [...records];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
};

const cardioid_point = (r, theta) => ({
  re:
    (r / 2) * Math.cos(2 * Math.PI * theta) -
    (r * r / 4) * Math.cos(4 * Math.PI * theta),
  im:
    (r / 2) * Math.sin(2 * Math.PI * theta) -
    (r * r / 4) * Math.sin(4 * Math.PI * theta),
});

const request_detection = async (base_url, test, options) => {
  const url = new URL("/orbital_pyramid", base_url);
  url.searchParams.set("re", test.point.re);
  url.searchParams.set("im", test.point.im);
  url.searchParams.set("iterations", options.iterations);
  url.searchParams.set("minimum_cycles", options.repetitions);
  const response = await fetch(url);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${url} (HTTP ${response.status})`);
  }
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  const detection = body.detection;
  const detected = Number(detection?.survivors?.[0]?.cardinality);
  return {
    ...test,
    detected: Number.isInteger(detected) ? detected : null,
    status: detection?.status || "unexpected_response_shape",
    detection_summary: {
      survivor_count: detection?.survivor_count,
      survivors: detection?.survivors?.slice(0, 10),
      harmonic_count: detection?.harmonic_count,
      period_validation_tolerance: detection?.period_validation_tolerance,
    },
  };
};

const options = parse_args(process.argv.slice(2));
console.log(
  "WARNING: this benchmark exercises the experimental pyramid_only detector.",
);
const data_url = await find_data_server(options.url);
const farey = await load_farey();
const selected = shuffled(farey).slice(0, options.sample_count).map((fraction) => {
  const r = options.r_min + Math.random() * (options.r_max - options.r_min);
  const theta = fraction.ratio;
  return {
    ...fraction,
    r,
    theta,
    expected: fraction.den,
    point: cardioid_point(r, theta),
  };
});
console.log(`Testing ${selected.length} random main-cardioid cases`);
const results = [];
for (const [index, test] of selected.entries()) {
  const result = await request_detection(data_url, test, options);
  results.push(result);
  console.log(
    `${index + 1}/${selected.length} theta=${test.num}/${test.den}, r=${test.r.toFixed(6)}: expected ${test.expected}, detected ${result.detected ?? "inconclusive"}`,
  );
}
const matches = results.filter((result) => result.detected === result.expected);
const report = {
  generated_at: new Date().toISOString(),
  experimental: true,
  data_url,
  source: "servers/fracto-data-server/farey_sequence.csv",
  options,
  pool_size: farey.length,
  sample_size: results.length,
  summary: {
    detected: results.filter((result) => result.detected !== null).length,
    inconclusive: results.filter((result) => result.detected === null).length,
    matches: matches.length,
    accuracy: results.length ? matches.length / results.length : null,
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
      `main-cardioid-${timestamp}.json`,
    );
await mkdir(path.dirname(output_file), { recursive: true });
await writeFile(output_file, JSON.stringify(report, null, 2));
console.log(
  `Matched ${matches.length}/${results.length}; wrote ${path.relative(ROOT_DIR, output_file)}`,
);
