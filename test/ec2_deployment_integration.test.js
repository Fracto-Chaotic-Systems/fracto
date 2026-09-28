import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '..')
const read = filepath => fs.readFileSync(path.join(ROOT, filepath), 'utf8')

test('production Docker ports stay on loopback for the host nginx proxy', () => {
   const compose = read('compose.yaml')
   for (const port of [3001, 3002, 3003, 3004, 3005, 3006]) {
      assert.match(compose, new RegExp(`127\\.0\\.0\\.1:${port}:${port}`))
      assert.doesNotMatch(compose, new RegExp(`(?:^|\\s)["']?${port}:${port}["']?`, 'm'))
   }
})

test('nginx sends the public UI and all five API prefixes to their service listeners', () => {
   const proxy = read('deploy/nginx/fracto.conf.example')
   const expected = [
      ['main', 3001],
      ['data', 3002],
      ['asset', 3003],
      ['tiles', 3004],
      ['admin', 3005],
   ]
   for (const [name, port] of expected) {
      assert.match(proxy, new RegExp(`location \\^~ /api/${name}/ \\{[\\s\\S]*?proxy_pass http://127\\.0\\.0\\.1:${port}/;`))
   }
   assert.match(proxy, /location \/ \{[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:3006;/)
   assert.match(proxy, /location \^~ \/api\/ \{\s*return 404;/)

   const headers = read('deploy/nginx/fracto-proxy-headers.conf.example')
   assert.match(headers, /proxy_set_header Host \$host;/)
   assert.match(headers, /proxy_set_header X-Forwarded-Proto \$scheme;/)
})

test('EC2 deployment waits for full-stack readiness and has read-only local tiles', () => {
   const compose = read('compose.yaml')
   const dockerfile = read('Dockerfile')
   const local_tiles = read('compose.local-tiles.yaml')
   const deploy = read('scripts/ec2_deploy.sh')
   const proxy_probe = read('scripts/verify_ec2_proxy.sh')
   const refresh = read('scripts/refresh_tile_index.js')
   const select_generation = read('scripts/select_tile_index_generation.js')

   assert.match(compose, /127\.0\.0\.1:3001:3001/)
   assert.match(dockerfile, /readyz/)
   assert.match(local_tiles, /FRACTO_TILE_SOURCE_MODE: local/)
   assert.match(local_tiles, /fracto:[\s\S]*?host\.docker\.internal:host-gateway/)
   assert.match(local_tiles, /database-init:[\s\S]*?host\.docker\.internal:host-gateway/)
   assert.match(local_tiles, /target: \/mnt\/fracto-tile-source\s+read_only: true/)
   assert.match(deploy, /scripts\/startup_preflight\.js/)
   assert.match(deploy, /up -d --wait --wait-timeout 300 fracto/)
   assert.doesNotMatch(deploy, /start:tiles-local-source|start_tiles_local_source\.js/)
   assert.match(proxy_probe, /api\/main\/readyz/)
   assert.match(proxy_probe, /COMPOSE=\(docker compose -f compose\.yaml -f compose\.local-tiles\.yaml\)/)
   assert.match(proxy_probe, /"\$\{COMPOSE\[@\]\}" port fracto/)
   assert.match(refresh, /FRACTO_TILE_INDEX_PUBLISH_CURRENT !== 'false'/)
   assert.match(refresh, /Prepared complete tile index generation/)
   assert.match(select_generation, /fs\.renameSync\(temporary_path, TILE_INDEX_CURRENT_FILE\)/)
})
