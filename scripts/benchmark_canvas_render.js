import {mkdir, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {spawn} from 'node:child_process'

let chalk
try {
   chalk = (await import('chalk')).default
} catch {
   chalk = {
      yellow: value => `\x1b[33m${value}\x1b[39m`,
   }
}

const requested_strategy = process.argv[2] || process.env.FRACTO_BENCHMARK_STRATEGY
if (!requested_strategy) {
   for (const suite of ['legacy', 'turbo']) {
      await new Promise((resolve, reject) => {
         const child = spawn(process.execPath, [process.argv[1], suite], {stdio: 'inherit'})
         child.on('error', reject)
         child.on('exit', code => code ? reject(new Error(`${suite} benchmark exited with code ${code}`)) : resolve())
      })
   }
   process.exit(0)
}
if (!['legacy', 'turbo'].includes(requested_strategy)) {
   throw new Error(`Unknown benchmark strategy "${requested_strategy}". Use legacy or turbo.`)
}
const strategy = requested_strategy

const configured_url = process.env.FRACTO_TILES_URL
const candidate_urls = configured_url
   ? [configured_url]
   : ['http://127.0.0.1:3004', 'http://127.0.0.1:3104']
const configured_data_url = process.env.FRACTO_DATA_URL
const candidate_data_urls = configured_data_url
   ? [configured_data_url]
   : ['http://127.0.0.1:3002', 'http://127.0.0.1:3102']
const repetitions = Math.max(1, Number.parseInt(process.env.FRACTO_BENCHMARK_REPETITIONS || '3', 10))
const start_index = Math.max(0, Number.parseInt(process.env.FRACTO_BENCHMARK_START_INDEX || '500', 10))
const end_index = Math.max(start_index, Number.parseInt(process.env.FRACTO_BENCHMARK_END_INDEX || '1000', 10))
const sample_count = Math.max(1, Number.parseInt(process.env.FRACTO_BENCHMARK_SAMPLE_COUNT || '25', 10))
const ZOOM_FACTOR = 1.618
const MAX_SCOPE = 2.5
const report_strategy = strategy
const started_at = new Date().toISOString()

const find_tiles_server = async () => {
   for (const candidate of candidate_urls) {
      try {
         const response = await fetch(`${candidate}/cache_status`, {
            signal: AbortSignal.timeout(1000),
         })
         if (response.ok) return candidate
      } catch (error) {
         if (configured_url) throw error
      }
   }
   throw new Error(
      'No local tiles server is reachable. Start production (port 3004) or development (port 3104), ' +
      'or set FRACTO_TILES_URL explicitly.'
   )
}

const find_data_server = async () => {
   for (const candidate of candidate_data_urls) {
      try {
         const response = await fetch(`${candidate}/`, {signal: AbortSignal.timeout(1000)})
         if (response.ok) return candidate
      } catch (error) {
         if (configured_data_url) throw error
      }
   }
   throw new Error(
      'No local data server is reachable. Start production (port 3002) or development (port 3102), ' +
      'or set FRACTO_DATA_URL explicitly.'
   )
}

const base_url = await find_tiles_server()
const data_url = await find_data_server()
console.log(`Running independent ${report_strategy} canvas benchmark at ${base_url}`)

const parse_json = value => {
   if (typeof value !== 'string') return value
   try {
      return JSON.parse(value)
   } catch (error) {
      return null
   }
}

const load_fixtures = async () => {
   const categories = [
      {name: 'free', is_node: 0, is_inline: 0},
      {name: 'inline', is_node: 0, is_inline: 1},
      {name: 'nodal', is_node: 1, is_inline: 0},
   ]
   const records = []
   for (const category of categories) {
      const params = new URLSearchParams({is_node: category.is_node, is_inline: category.is_inline})
      const response = await fetch(`${data_url}/minibrots?${params}`)
      if (!response.ok) throw new Error(`free_bailiwicks ${category.name}: HTTP ${response.status}`)
      const body = await response.json()
      for (const record of body.result || []) records.push({...record, category: category.name})
   }
   records.sort((left, right) => Number(right.magnitude) - Number(left.magnitude))
   const candidates = records.slice(start_index, end_index + 1)
   if (!candidates.length) throw new Error(`No free_bailiwicks records found in indexes ${start_index}-${end_index}`)
   const shuffled = [...candidates]
   for (let index = shuffled.length - 1; index > 0; index--) {
      const swap_index = Math.floor(Math.random() * (index + 1))
      const current = shuffled[index]
      shuffled[index] = shuffled[swap_index]
      shuffled[swap_index] = current
   }
   const selected = shuffled.slice(0, Math.min(sample_count, shuffled.length))

   const fixtures = []
   for (const [index, record] of selected.entries()) {
      const settings = parse_json(record.display_settings)
      const focal_point = parse_json(settings?.focal_point)
      let scope = Number(settings?.scope)
      if (!Number.isFinite(scope) || scope <= 0 || !Number.isFinite(Number(focal_point?.x)) || !Number.isFinite(Number(focal_point?.y))) continue
      let step = 0
      while (scope <= MAX_SCOPE) {
         fixtures.push({
            name: `${record.category}-${record.id || index}-${step}`,
            step,
            width_px: 256,
            focal_point_x: Number(focal_point.x),
            focal_point_y: Number(focal_point.y),
            scope,
            aspect_ratio: 1,
            resolution_factor: 1.5,
            source: {
               id: record.id,
               category: record.category,
               magnitude: Number(record.magnitude),
               source_index: start_index + shuffled.indexOf(record),
            },
         })
         scope *= ZOOM_FACTOR
         step++
      }
   }
   if (!fixtures.length) throw new Error(`Selected free_bailiwick records have no usable display settings`)
   console.log(`Randomly selected ${selected.length} of ${candidates.length} free_bailiwick records (${fixtures.length} zoom fixtures) from indexes ${start_index}-${end_index}.`)
   return fixtures
}

const fixtures = await load_fixtures()

const render = async (fixture) => {
   const {source, ...request_fixture} = fixture
   const params = new URLSearchParams({...request_fixture, strategy})
   const started = performance.now()
   const response = await fetch(`${base_url}/canvas_buffer?${params}`)
   if (!response.ok) throw new Error(`${strategy} ${fixture.name}: HTTP ${response.status}`)
   const body = await response.json()
   if (!Array.isArray(body.canvas_buffer) || body.canvas_buffer.length !== fixture.width_px) {
      throw new Error(`${strategy} ${fixture.name}: invalid canvas_buffer width`)
   }
   const height_px = body.canvas_buffer[0]?.length || 0
   if (!height_px || body.canvas_buffer.some(column => !Array.isArray(column) || column.length !== height_px)) {
      throw new Error(`${strategy} ${fixture.name}: invalid canvas_buffer height`)
   }
   return {body, elapsed_ms: performance.now() - started}
}

const median = values => {
   const sorted = [...values].sort((a, b) => a - b)
   return sorted[Math.floor(sorted.length / 2)]
}

const results = []
const run_numbers = new Map()
for (const fixture of fixtures) {
   const source = fixture.source || {}
   const run_key = `${source.category || 'unknown'}-${source.id || fixture.name}`
   if (!run_numbers.has(run_key)) run_numbers.set(run_key, run_numbers.size + 1)
   const run_number = run_numbers.get(run_key)
   // Warm this strategy's fixtures only; warm-up requests are not measured.
   const warmup = await render(fixture)
   const samples = []
   const reference_buffer = JSON.stringify(warmup.body.canvas_buffer)
   for (let index = 0; index < repetitions; index++) {
      const result = await render(fixture)
      if (JSON.stringify(result.body.canvas_buffer) !== reference_buffer) {
         throw new Error(`${strategy} ${fixture.name}: output changed between runs`)
      }
      samples.push(result.elapsed_ms)
   }
   results.push({
      name: fixture.name,
      source: fixture.source,
      parameters: {
         step: fixture.step,
         width_px: fixture.width_px,
         focal_point_x: fixture.focal_point_x,
         focal_point_y: fixture.focal_point_y,
         scope: fixture.scope,
         aspect_ratio: fixture.aspect_ratio,
         resolution_factor: fixture.resolution_factor,
      },
      warmup_ms: warmup.elapsed_ms,
      samples,
      summary: {
         min_ms: Math.min(...samples),
         median_ms: median(samples),
         max_ms: Math.max(...samples),
      },
   })
   console.log(
      chalk.yellow(`${report_strategy} #${run_number}:`) +
      ` ${fixture.name}: min ${Math.min(...samples).toFixed(1)}ms, ` +
      `median ${median(samples).toFixed(1)}ms, max ${Math.max(...samples).toFixed(1)}ms ` +
      `(${repetitions} samples)`
   )
}

console.log(`${report_strategy} benchmarked ${run_numbers.size} runs`)

const completed_at = new Date().toISOString()
const report = {
   schema_version: 1,
   started_at,
   completed_at,
   strategy: report_strategy,
   requested_strategy: report_strategy,
   tiles_url: base_url,
   data_url,
   selection: {
      start_index,
      end_index,
      sample_count,
      selected_count: new Set(results.map(result => result.source?.id)).size,
      zoom_factor: ZOOM_FACTOR,
      max_scope: MAX_SCOPE,
      repetitions,
   },
   fixtures: results,
}
const report_directory = path.resolve('servers/fracto-tiles-server/benchmarks', report_strategy)
await mkdir(report_directory, {recursive: true})
const report_name = `${completed_at.replaceAll(':', '-').replaceAll('.', '-')}.json`
const report_path = path.join(report_directory, report_name)
await writeFile(report_path, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(`Saved benchmark report to ${report_path}`)
console.log(`${report_strategy} canvas benchmark passed.`)
