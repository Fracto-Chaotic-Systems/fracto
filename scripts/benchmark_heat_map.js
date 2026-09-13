import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const TILE_URLS = ["http://127.0.0.1:3004", "http://127.0.0.1:3104"];
const DATA_URLS = ["http://127.0.0.1:3002", "http://127.0.0.1:3102"];
const DEFAULT_WIDTHS = [256, 512, 1024];
const ZOOM_FIXTURE_DEFAULTS = {
  start_index: 500,
  end_index: 1000,
  sample_count: 25,
  repetitions: 3,
};

const usage = () => {
  console.log(
    "Usage: npm run tiles:benchmark:heat-map -- [options]",
  );
  console.log(
    "Options: --tiles-url URL --data-url URL --sample-count N --start-index N --end-index N --repetitions N --widths 256,512,1024 --output FILE",
  );
};

const parse_args = (args) => {
  const options = {
    tiles_url: process.env.FRACTO_TILES_URL,
    data_url: process.env.FRACTO_DATA_URL,
    sample_count: Number(
      process.env.FRACTO_HEAT_MAP_SAMPLE_COUNT ||
        ZOOM_FIXTURE_DEFAULTS.sample_count,
    ),
    start_index: Number(
      process.env.FRACTO_HEAT_MAP_START_INDEX ||
        ZOOM_FIXTURE_DEFAULTS.start_index,
    ),
    end_index: Number(
      process.env.FRACTO_HEAT_MAP_END_INDEX ||
        ZOOM_FIXTURE_DEFAULTS.end_index,
    ),
    repetitions: Number(
      process.env.FRACTO_HEAT_MAP_REPETITIONS ||
        ZOOM_FIXTURE_DEFAULTS.repetitions,
    ),
    widths: DEFAULT_WIDTHS,
    output: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const [key, inline_value] = args[index].split("=", 2);
    const value_for = () => inline_value ?? args[++index];
    if (key === "--help" || key === "-h") {
      usage();
      process.exit(0);
    }
    if (key === "--tiles-url") options.tiles_url = value_for();
    else if (key === "--data-url") options.data_url = value_for();
    else if (key === "--sample-count") options.sample_count = Number(value_for());
    else if (key === "--start-index") options.start_index = Number(value_for());
    else if (key === "--end-index") options.end_index = Number(value_for());
    else if (key === "--repetitions") options.repetitions = Number(value_for());
    else if (key === "--widths") {
      options.widths = value_for()
        .split(",")
        .map(Number)
        .filter((width) => Number.isInteger(width) && width > 0);
    } else if (key === "--output") options.output = value_for();
    else throw new Error(`Unknown argument "${args[index]}"`);
  }
  if (!Number.isInteger(options.sample_count) || options.sample_count < 1) {
    throw new Error("--sample-count must be a positive integer");
  }
  if (!Number.isInteger(options.start_index) || options.start_index < 0) {
    throw new Error("--start-index must be a non-negative integer");
  }
  if (!Number.isInteger(options.end_index) || options.end_index < options.start_index) {
    throw new Error("--end-index must be at least --start-index");
  }
  if (!Number.isInteger(options.repetitions) || options.repetitions < 1) {
    throw new Error("--repetitions must be a positive integer");
  }
  if (!options.widths.length) throw new Error("--widths must contain a value");
  return options;
};

const find_server = async (configured_url, candidates, path_name, label) => {
  const urls = configured_url ? [configured_url] : candidates;
  for (const base_url of urls) {
    try {
      const response = await fetch(`${base_url}${path_name}`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return base_url;
    } catch (error) {
      if (configured_url) throw error;
    }
  }
  throw new Error(`No local ${label} server is reachable`);
};

const parse_json = (value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const shuffled = (records) => {
  const result = [...records];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
};

const load_fixtures = async (data_url, options) => {
  const categories = [
    { name: "free", is_node: 0, is_inline: 0 },
    { name: "inline", is_node: 0, is_inline: 1 },
    { name: "nodal", is_node: 1, is_inline: 0 },
  ];
  const records = [];
  for (const category of categories) {
    const params = new URLSearchParams({
      is_node: category.is_node,
      is_inline: category.is_inline,
      limit: 20000,
    });
    const response = await fetch(`${data_url}/minibrots?${params}`);
    if (!response.ok) {
      throw new Error(`free_bailiwicks ${category.name}: HTTP ${response.status}`);
    }
    const body = await response.json();
    for (const record of body.result || []) {
      records.push({ ...record, category: category.name });
    }
  }
  records.sort((left, right) => Number(right.magnitude) - Number(left.magnitude));
  const candidates = records.slice(options.start_index, options.end_index + 1);
  const selected = shuffled(candidates).slice(
    0,
    Math.min(options.sample_count, candidates.length),
  );
  const fixtures = [];
  for (const [index, record] of selected.entries()) {
    const settings = parse_json(record.display_settings);
    const focal_point = parse_json(settings?.focal_point);
    const scope = Number(settings?.scope);
    if (
      !Number.isFinite(scope) ||
      scope <= 0 ||
      !Number.isFinite(Number(focal_point?.x)) ||
      !Number.isFinite(Number(focal_point?.y))
    ) {
      continue;
    }
    for (const width_px of options.widths) {
      fixtures.push({
        name: `${record.category}-${record.id || index}-${width_px}`,
        width_px,
        focal_point_x: Number(focal_point.x),
        focal_point_y: Number(focal_point.y),
        scope,
        aspect_ratio: 1,
        source: {
          id: record.id,
          category: record.category,
          magnitude: Number(record.magnitude),
          source_index: records.indexOf(record),
        },
      });
    }
  }
  if (!fixtures.length) {
    throw new Error("Selected free_bailiwicks records have no usable display settings");
  }
  console.log(
    `Randomly selected ${selected.length} of ${candidates.length} free_bailiwick records (${fixtures.length} heat-map fixtures).`,
  );
  return fixtures;
};

const request_heat_map = async (tiles_url, fixture) => {
  const params = new URLSearchParams({
    width_px: fixture.width_px,
    focal_point_x: fixture.focal_point_x,
    focal_point_y: fixture.focal_point_y,
    scope: fixture.scope,
    aspect_ratio: fixture.aspect_ratio,
  });
  const started = performance.now();
  const response = await fetch(`${tiles_url}/heat_map_buffer?${params}`);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${fixture.name}: HTTP ${response.status}`);
  }
  const buffer = body?.heat_map_buffer;
  if (
    !Array.isArray(buffer) ||
    buffer.length !== fixture.width_px ||
    !buffer[0]?.length ||
    buffer.some((column) => !Array.isArray(column) || column.length !== buffer[0].length)
  ) {
    throw new Error(`${fixture.name}: invalid heat-map buffer shape`);
  }
  return {
    elapsed_ms: performance.now() - started,
    width_px: buffer.length,
    height_px: buffer[0].length,
    coverage_levels: Array.isArray(body.coverage) ? body.coverage.length : 0,
    server_timings_ms: body.timings_ms || null,
  };
};

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
};

const options = parse_args(process.argv.slice(2));
const tiles_url = await find_server(options.tiles_url, TILE_URLS, "/", "tiles");
const data_url = await find_server(options.data_url, DATA_URLS, "/", "data");
const fixtures = await load_fixtures(data_url, options);
const results = [];
for (const [index, fixture] of fixtures.entries()) {
  await request_heat_map(tiles_url, fixture);
  const samples = [];
  let shape = null;
  for (let repetition = 0; repetition < options.repetitions; repetition += 1) {
    const result = await request_heat_map(tiles_url, fixture);
    shape = {
      width_px: result.width_px,
      height_px: result.height_px,
      coverage_levels: result.coverage_levels,
      server_timings_ms: result.server_timings_ms,
    };
    samples.push(result.elapsed_ms);
  }
  const summary = {
    min_ms: Math.min(...samples),
    median_ms: median(samples),
    max_ms: Math.max(...samples),
  };
  results.push({ ...fixture, shape, samples, summary });
  console.log(
    `${index + 1}/${fixtures.length} ${fixture.name}: min ${summary.min_ms.toFixed(1)}ms, median ${summary.median_ms.toFixed(1)}ms, max ${summary.max_ms.toFixed(1)}ms`,
  );
}

const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  tiles_url,
  data_url,
  selection: {
    start_index: options.start_index,
    end_index: options.end_index,
    sample_count: options.sample_count,
    repetitions: options.repetitions,
    widths: options.widths,
  },
  fixtures: results,
};
const report_directory = path.join(
  ROOT_DIR,
  "servers",
  "fracto-tiles-server",
  "benchmarks",
  "heat-map",
);
await mkdir(report_directory, { recursive: true });
const timestamp = report.generated_at.replaceAll(":", "-").replaceAll(".", "-");
const output_file = options.output
  ? path.resolve(ROOT_DIR, options.output)
  : path.join(report_directory, `${timestamp}.json`);
await mkdir(path.dirname(output_file), { recursive: true });
await writeFile(output_file, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Saved heat-map benchmark report to ${path.relative(ROOT_DIR, output_file)}`);
