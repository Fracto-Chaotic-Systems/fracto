import assert from 'node:assert/strict'
import express from 'express'
import {after, before, describe, test} from 'node:test'

import {handle_logs} from '../handlers/logs.js'
import {format_log_records} from '../utils/logging.js'

const app = express()
app.get('/logs', handle_logs)
let server
let base_url

before(() => new Promise(resolve => {
   server = app.listen(0, () => {
      base_url = `http://127.0.0.1:${server.address().port}`
      resolve()
   })
}))

after(() => new Promise(resolve => server.close(resolve)))

describe('main log endpoint', () => {
   test('rejects unknown service selectors', async () => {
      const response = await fetch(`${base_url}/logs?service=unknown`)
      const body = await response.json()

      assert.equal(response.status, 400)
      assert.match(body.error, /Unknown log service/)
   })

   test('returns the stable log response for supported selectors', async () => {
      for (const service of ['main', 'admin', 'data', 'asset', 'tiles', 'ui', 'all']) {
         const response = await fetch(`${base_url}/logs?service=${service}`)
         const body = await response.json()

         assert.equal(response.status, 200)
         assert.ok(Array.isArray(body.lines))
         assert.ok(Array.isArray(body.records))
         assert.equal(typeof body.logfile_name, 'string')
      }
   })

   test('uses the root logfile alias for the main service', () => {
      const result = format_log_records('main', [])
      assert.match(result.logfile_name, /^fracto-root-log-/)
   })
})
