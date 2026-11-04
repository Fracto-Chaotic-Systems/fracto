import assert from 'node:assert/strict'
import {spawn, spawnSync} from 'node:child_process'
import {once} from 'node:events'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {ALL_SERVICES, SERVICE_NAME_AI, FRACTO_AI_PORT} from '../constants.js'
import {create_health_handler} from '../handlers/health.js'
import {format_log_records} from '../utils/logging.js'

const ROOT = path.resolve(import.meta.dirname, '..')

test('AI participates in readiness and has its own centralized log selector', () => {
   const service = ALL_SERVICES.find(item => item.name === SERVICE_NAME_AI)
   assert.equal(service.port, FRACTO_AI_PORT)
   assert.equal(service.health_path, '/readyz')
   const states = new Map(ALL_SERVICES.map(item => [item.name, 'healthy']))
   states.set(SERVICE_NAME_AI, 'starting')
   let status, body
   const response = {
      set() {},
      status(value) {status = value; return this},
      json(value) {body = value},
   }
   create_health_handler(states)({path: '/readyz'}, response)
   assert.equal(status, 503)
   assert.equal(body.services[SERVICE_NAME_AI], 'starting')
   states.set(SERVICE_NAME_AI, 'healthy')
   create_health_handler(states)({path: '/readyz'}, response)
   assert.equal(status, 200)
   assert.match(format_log_records('ai', []).logfile_name, /^fracto-ai-server-log-/)
})

test('admin discovers AI with legacy port files and validates overrides', t => {
   const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fracto-ai-ports-'))
   t.after(() => fs.rmSync(directory, {recursive: true, force: true}))
   const file = path.join(directory, 'ports.json')
   fs.writeFileSync(file, JSON.stringify({ports: {main: 3001, data: 3002, asset: 3003, tiles: 3004, admin: 3005, ui: 3006}}))
   const run = overrides => {
      const env = {...process.env}
      for (const name of Object.keys(env)) {
         if (/^FRACTO_(SERVER|DATA|ASSET|TILES|ADMIN|UI|AI)_PORT$/.test(name)) delete env[name]
      }
      return spawnSync(process.execPath, ['--input-type=module', '-e',
         "import {get_ports} from './servers/fracto-admin-server/handlers/ports.js'; process.stdout.write(JSON.stringify(get_ports().ports))",
      ], {cwd: ROOT, env: {...env, FRACTO_PORTS_FILE: file, ...overrides}, encoding: 'utf8'})
   }
   let result = run({})
   assert.equal(result.status, 0, result.stderr)
   assert.equal(JSON.parse(result.stdout).ai, 3007)
   result = run({FRACTO_AI_PORT: '3107'})
   assert.equal(result.status, 0, result.stderr)
   assert.equal(JSON.parse(result.stdout).ai, 3107)
   result = run({FRACTO_AI_PORT: '3002'})
   assert.notEqual(result.status, 0)
   assert.match(result.stderr, /Invalid or duplicate service ports/)
})

test('standard launcher serves AI health on its configured port', async t => {
   const data_directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fracto-ai-launcher-'))
   const reservation = net.createServer().listen(0, '127.0.0.1')
   await once(reservation, 'listening')
   const port = reservation.address().port
   await new Promise(resolve => reservation.close(resolve))
   const peer_reservation = net.createServer().listen(0, '127.0.0.1')
   await once(peer_reservation, 'listening')
   const peer_port = peer_reservation.address().port
   await new Promise(resolve => peer_reservation.close(resolve))
   const child = spawn(process.execPath, ['scripts/launch_service.js', SERVICE_NAME_AI], {
      cwd: ROOT,
      env: {...process.env, FRACTO_AI_DATA_DIR: data_directory, FRACTO_AI_PEER_DATA_DIR: path.join(data_directory, 'peers'), FRACTO_AI_PORT: String(port), FRACTO_AI_PEERS_ENABLED: 'true', FRACTO_AI_PEER_LISTEN_HOST: '127.0.0.1', FRACTO_AI_PEER_PORT: String(peer_port), FRACTO_WATCH: 'false', FRACTO_OLLAMA_ENABLED: 'false'},
      stdio: ['ignore', 'pipe', 'pipe'],
   })
   let output = '', exit_seen = false
   child.stdout.on('data', chunk => {output += chunk})
   child.stderr.on('data', chunk => {output += chunk})
   const ended = new Promise(resolve => {
      child.once('exit', () => {exit_seen = true; resolve()})
      child.once('error', () => {exit_seen = true; resolve()})
   })
   t.after(async () => {
      if (!exit_seen) {
         if (process.platform === 'win32') {
            spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {stdio: 'ignore'})
         } else child.kill('SIGTERM')
      }
      await ended
      assert.equal(path.dirname(path.resolve(data_directory)), path.resolve(os.tmpdir()))
      assert.ok(path.basename(data_directory).startsWith('fracto-ai-launcher-'))
      fs.rmSync(data_directory, {recursive: true, force: true})
   })
   const deadline = Date.now() + 10000
   let response
   while (Date.now() < deadline && !exit_seen) {
      try {
         response = await fetch(`http://127.0.0.1:${port}/readyz`, {signal: AbortSignal.timeout(500)})
         if (response.ok) break
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 50))
   }
   assert.ok(response?.ok, output || 'AI listener did not become ready')
   const body = await response.json()
   assert.equal(body.service, SERVICE_NAME_AI)
   assert.equal(body.stage, 'foundation')
   assert.deepEqual(body.capabilities, [])
   let peer_status
   while (Date.now() < deadline && !exit_seen) {
      peer_status = await (await fetch(`http://127.0.0.1:${port}/peers/status`)).json()
      if (peer_status.state === 'ready') break
      await new Promise(resolve => setTimeout(resolve, 50))
   }
   assert.equal(peer_status?.state, 'ready', output)
   assert.equal(peer_status.trusted_peers, 0)
   assert.equal(peer_status.capabilities.artifacts, true)
   assert.equal(peer_status.exchange.state, 'ready')
   assert.equal(peer_status.capabilities.delegation, true)
   assert.equal(peer_status.delegation.state, 'ready')
   assert.ok(fs.existsSync(path.join(data_directory, 'peers', 'identity.json')))
})
