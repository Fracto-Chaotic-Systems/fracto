import assert from 'node:assert/strict'
import express from 'express'
import {after, before, describe, test} from 'node:test'

import {create_health_handler} from '../handlers/health.js'

const service_states = new Map([
   ['fracto-data-server', 'pending'],
   ['fracto-tiles-server', 'starting'],
])
const app = express()
app.get('/healthz', create_health_handler(service_states))
app.get('/readyz', create_health_handler(service_states))
let server
let base_url

before(() => new Promise(resolve => {
   server = app.listen(0, () => {
      base_url = `http://127.0.0.1:${server.address().port}`
      resolve()
   })
}))

after(() => new Promise(resolve => server.close(resolve)))

describe('health endpoints', () => {
   test('reports liveness while services are starting', async () => {
      const response = await fetch(`${base_url}/healthz`)
      const body = await response.json()

      assert.equal(response.status, 200)
      assert.equal(body.status, 'starting')
      assert.deepEqual(body.services, Object.fromEntries(service_states))
   })

   test('reports readiness only after every service is healthy', async () => {
      let response = await fetch(`${base_url}/readyz`)
      assert.equal(response.status, 503)

      for (const name of service_states.keys()) service_states.set(name, 'healthy')
      response = await fetch(`${base_url}/readyz`)
      const body = await response.json()

      assert.equal(response.status, 200)
      assert.equal(body.status, 'ready')
      assert.deepEqual(body.services, {
         'fracto-data-server': 'healthy',
         'fracto-tiles-server': 'healthy',
      })
   })
})
