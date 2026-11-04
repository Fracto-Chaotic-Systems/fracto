import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import fs from 'node:fs'
import test from 'node:test'
import {start_windows_startup_benchmark} from '../utils/startup_benchmark.js'
import {create_health_handler} from '../handlers/health.js'

test('Windows observer bootstraps hidden; unsupported hosts do not spawn', () => {
   const calls = []
   const child = new EventEmitter()
   const spawn_process = (...args) => {calls.push(args); return child}
   assert.equal(start_windows_startup_benchmark({port: 3101, platform: 'linux', spawn_process}), false)
   assert.equal(start_windows_startup_benchmark({port: 3101, platform: 'win32', environment: {FRACTO_STARTUP_BENCHMARK: 'false'}, spawn_process}), false)
   assert.equal(start_windows_startup_benchmark({port: 3101, platform: 'win32', environment: {}, spawn_process}), true)
   assert.equal(calls.length, 1)
   assert.equal(calls[0][0], 'powershell.exe')
   assert.equal(calls[0][1].at(-1), '3101')
   assert.equal(calls[0][2].windowsHide, true)
})

test('failure to launch the host observer does not throw or fail startup', () => {
   let errors = 0
   const result = start_windows_startup_benchmark({port: 3101, platform: 'win32', environment: {},
      spawn_process: () => {throw new Error('blocked')}, on_error: () => errors++})
   assert.equal(result, false)
   assert.equal(errors, 1)
})

test('health has a stable non-personal startup marker unique to each handler instance', () => {
   const states = new Map([['data', 'healthy']])
   let body
   const res = {set() {}, status() {return this}, json(value) {body = value}}
   const first = create_health_handler(states)
   first({path: '/healthz'}, res)
   const id = body.startup_id
   first({path: '/readyz'}, res)
   assert.equal(body.startup_id, id)
   create_health_handler(states)({path: '/healthz'}, res)
   assert.notEqual(body.startup_id, id)
})

test('Windows startup entrypoints include the nonblocking benchmark hook', () => {
   for (const file of ['launch-production.bat', 'launch-development.bat', 'first-run.bat', 'cold_boot.bat']) {
      const source = fs.readFileSync(new URL(`../scripts/${file}`, import.meta.url), 'utf8')
      assert.match(source, /node scripts\\windows_host_startup\.js --port 3[01]01/)
   }
})
