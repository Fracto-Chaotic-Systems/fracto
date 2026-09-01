const configured_url = process.env.FRACTO_TILES_URL
const candidate_urls = configured_url
   ? [configured_url]
   : ['http://127.0.0.1:3004', 'http://127.0.0.1:3104']
const max_ratio = Number(process.env.FRACTO_BENCHMARK_MAX_RATIO || 3)

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

const base_url = await find_tiles_server()
console.log(`Benchmarking tiles server at ${base_url}`)

const fixtures = [
   {name: 'overview', width_px: 256, focal_point_x: -0.75, focal_point_y: 0, scope: 2.5, aspect_ratio: 1, resolution_factor: 1.5},
   {name: 'detail', width_px: 256, focal_point_x: -0.7436, focal_point_y: 0.1318, scope: 0.01, aspect_ratio: 1, resolution_factor: 1.5},
]

const render = async (fixture, strategy) => {
   const params = new URLSearchParams({...fixture, strategy})
   const started = performance.now()
   const response = await fetch(`${base_url}/canvas_buffer?${params}`)
   if (!response.ok) throw new Error(`${strategy} ${fixture.name}: HTTP ${response.status}`)
   const body = await response.json()
   if (!Array.isArray(body.canvas_buffer)) throw new Error(`${strategy} ${fixture.name}: response did not contain canvas_buffer`)
   return {body, elapsed_ms: performance.now() - started}
}

const equal_json = (left, right) => JSON.stringify(left) === JSON.stringify(right)

// Populate the tile server's in-memory cache for both strategies before timing.
// This keeps disk/network loading out of the comparison and makes the result
// focus on the rasterization work itself.
for (const fixture of fixtures) {
   await render(fixture, 'legacy')
   await render(fixture, 'masked')
}
console.log('Tile cache warmed for all benchmark fixtures.')

for (const fixture of fixtures) {
   const masked = await render(fixture, 'masked')
   const legacy = await render(fixture, 'legacy')
   const ratio = masked.elapsed_ms / Math.max(legacy.elapsed_ms, 0.001)
   console.log(`${fixture.name}: legacy ${legacy.elapsed_ms.toFixed(1)}ms, masked ${masked.elapsed_ms.toFixed(1)}ms, ratio ${ratio.toFixed(2)}x`)
   if (!equal_json(legacy.body.canvas_buffer, masked.body.canvas_buffer)) {
      throw new Error(`${fixture.name}: legacy and masked canvas buffers differ`)
   }
   if (ratio > max_ratio) {
      throw new Error(`${fixture.name}: masked renderer exceeded ${max_ratio}x legacy runtime`)
   }
}
console.log('Canvas renderer benchmark passed.')
