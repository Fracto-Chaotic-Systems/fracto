import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DATA_URLS = ['http://127.0.0.1:3002', 'http://127.0.0.1:3102'];

const usage = () => {
   console.log('Usage: node scripts/circuitry_harness.js --pairs "re,im;re,im" [options]');
   console.log('Options: --url URL --limit N --samples N --output FILE');
};

const parse_pair = value => {
   const values = value.split(',').map(Number);
   if (values.length !== 2 || values.some(number => !Number.isFinite(number))) {
      throw new Error(`Invalid focal-point pair "${value}"; expected re,im`);
   }
   return {re: values[0], im: values[1]};
};

const parse_args = args => {
   const options = {
      pairs: [],
      url: process.env.FRACTO_DATA_URL,
      limit: Number(process.env.FRACTO_CIRCUITRY_LIMIT || 256),
      samples: Number(process.env.FRACTO_CIRCUITRY_SAMPLES || 256),
      output: null,
   };
   for (let index = 0; index < args.length; index += 1) {
      const argument = args[index];
      const [key, inline_value] = argument.split('=', 2);
      const value_for = () => inline_value ?? args[++index];
      if (key === '--help' || key === '-h') {
         usage();
         process.exit(0);
      }
      if (key === '--pairs' || key === '--pair') {
         const value = value_for();
         options.pairs.push(...value.split(';').filter(Boolean).map(parse_pair));
      } else if (key === '--url') {
         options.url = value_for();
      } else if (key === '--limit') {
         options.limit = Number(value_for());
      } else if (key === '--samples') {
         options.samples = Number(value_for());
      } else if (key === '--output') {
         options.output = value_for();
      } else if (argument.includes(',')) {
         options.pairs.push(parse_pair(argument));
      } else {
         throw new Error(`Unknown argument "${argument}"`);
      }
   }
   if (options.pairs.length === 0) {
      throw new Error('At least one focal-point pair is required');
   }
   if (!Number.isInteger(options.limit) || options.limit < 1) {
      throw new Error('--limit must be a positive integer');
   }
   if (!Number.isInteger(options.samples) || options.samples < 2) {
      throw new Error('--samples must be an integer of at least 2');
   }
   return options;
};

const find_data_server = async configured_url => {
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
   throw new Error('No local data server is reachable; start port 3002 or 3102');
};

const request_curve = async (base_url, focal_point, options) => {
   const url = new URL('/circuitry', base_url);
   url.searchParams.set('re', focal_point.re);
   url.searchParams.set('im', focal_point.im);
   url.searchParams.set('limit', options.limit);
   url.searchParams.set('samples', options.samples);
   const response = await fetch(url);
   const body = await response.json();
   if (!response.ok) {
      throw new Error(body.error || `Circuitry request failed with HTTP ${response.status}`);
   }
   return body;
};

const options = parse_args(process.argv.slice(2));
const data_url = await find_data_server(options.url);
const results = [];
for (const focal_point of options.pairs) {
   console.log(`Sampling circuitry for (${focal_point.re}, ${focal_point.im})`);
   const result = await request_curve(data_url, focal_point, options);
   results.push({focal_point, ...result});
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const output_file = options.output
   ? path.resolve(ROOT_DIR, options.output)
   : path.join(
      ROOT_DIR,
      'servers',
      'fracto-data-server',
      'benchmarks',
      'circuitry',
      `circuitry-${timestamp}.json`,
   );
await mkdir(path.dirname(output_file), {recursive: true});
await writeFile(output_file, JSON.stringify({
   generated_at: new Date().toISOString(),
   data_url,
   options: {
      limit: options.limit,
      samples: options.samples,
   },
   results,
}, null, 2));
console.log(`Wrote circuitry results to ${path.relative(ROOT_DIR, output_file)}`);
