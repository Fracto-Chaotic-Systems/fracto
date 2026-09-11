import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DEFAULT_DATA_URLS = ["http://127.0.0.1:3002", "http://127.0.0.1:3102"];

const usage = () => {
  console.log(
    'Usage: node scripts/orbital_newton_harness.js --pairs "re,im;re,im" [options]',
  );
  console.log(
    "Options: --url URL --iterations N --repetitions N --newton-limit N --mode native|big_complex|both --output FILE",
  );
};

const parse_pair = (value) => {
  const values = value.split(",").map(Number);
  if (
    values.length !== 2 ||
    values.some((number) => !Number.isFinite(number))
  ) {
    throw new Error(`Invalid focal-point pair "${value}"; expected re,im`);
  }
  return { re: values[0], im: values[1] };
};

const parse_args = (args) => {
  const options = {
    pairs: [],
    url: process.env.FRACTO_DATA_URL,
    iterations: Number(process.env.FRACTO_ORBITAL_ITERATIONS || 4096),
    repetitions: Number(process.env.FRACTO_RETURN_REPETITIONS || 5),
    newton_limit: Number(process.env.FRACTO_NEWTON_LIMIT || 5),
    mode: process.env.FRACTO_NEWTON_MODE || "both",
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
    if (key === "--pairs" || key === "--pair") {
      options.pairs.push(
        ...value_for().split(";").filter(Boolean).map(parse_pair),
      );
    } else if (key === "--url") options.url = value_for();
    else if (key === "--iterations") options.iterations = Number(value_for());
    else if (key === "--repetitions") options.repetitions = Number(value_for());
    else if (key === "--newton-limit")
      options.newton_limit = Number(value_for());
    else if (key === "--mode") options.mode = value_for();
    else if (key === "--output") options.output = value_for();
    else if (argument.includes(",")) options.pairs.push(parse_pair(argument));
    else throw new Error(`Unknown argument "${argument}"`);
  }
  if (options.pairs.length === 0)
    throw new Error("At least one focal-point pair is required");
  if (!Number.isInteger(options.iterations) || options.iterations < 1) {
    throw new Error("--iterations must be a positive integer");
  }
  if (!Number.isInteger(options.repetitions) || options.repetitions < 5) {
    throw new Error("--repetitions must be an integer of at least 5");
  }
  if (!Number.isInteger(options.newton_limit) || options.newton_limit < 1) {
    throw new Error("--newton-limit must be a positive integer");
  }
  if (!["native", "big_complex", "both"].includes(options.mode)) {
    throw new Error("--mode must be native, big_complex, or both");
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

const request_newton = async (base_url, focal_point, options) => {
  const url = new URL("/orbital_newton", base_url);
  url.searchParams.set("re", focal_point.re);
  url.searchParams.set("im", focal_point.im);
  url.searchParams.set("iterations", options.iterations);
  url.searchParams.set("minimum_return_repetitions", options.repetitions);
  url.searchParams.set("newton_limit", options.newton_limit);
  url.searchParams.set("newton_mode", options.mode);
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      body.error ||
        `Orbital Newton request failed with HTTP ${response.status}`,
    );
  }
  return body;
};

const options = parse_args(process.argv.slice(2));
const data_url = await find_data_server(options.url);
const results = [];
for (const focal_point of options.pairs) {
  console.log(`Detecting and refining (${focal_point.re}, ${focal_point.im})`);
  results.push({
    focal_point,
    ...(await request_newton(data_url, focal_point, options)),
  });
}
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const output_file = options.output
  ? path.resolve(ROOT_DIR, options.output)
  : path.join(
      ROOT_DIR,
      "servers",
      "fracto-data-server",
      "benchmarks",
      "orbital-newton",
      `orbital-newton-${timestamp}.json`,
    );
await mkdir(path.dirname(output_file), { recursive: true });
await writeFile(
  output_file,
  JSON.stringify(
    { generated_at: new Date().toISOString(), data_url, options, results },
    null,
    2,
  ),
);
console.log(
  `Wrote orbital Newton results to ${path.relative(ROOT_DIR, output_file)}`,
);
