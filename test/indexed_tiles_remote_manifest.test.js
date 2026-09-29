import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {test} from 'node:test'

const with_server = async (handler, callback) => {
   const server = createServer(handler)
   await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
   })
   try {
      await callback(`http://127.0.0.1:${server.address().port}`)
   } finally {
      await new Promise(resolve => server.close(resolve))
   }
}

test('remote shortcode listings still parse CSV rows', async () => {
   const previous_mode = process.env.FRACTO_TILE_SOURCE_MODE
   const previous_base_url = process.env.FRACTO_TILE_REMOTE_BASE_URL
   process.env.FRACTO_TILE_SOURCE_MODE = 'remote-cache'

   try {
      await with_server((request, response) => {
         assert.equal(request.url, '/manifest/indexed.csv')
         response.writeHead(200, {'Content-Type': 'text/csv'})
         response.end('short_code\n12\n123\n')
      }, async base_url => {
         process.env.FRACTO_TILE_REMOTE_BASE_URL = base_url
         const {FractoIndexedTiles} = await import('../sdk/FractoIndexedTiles.js')
         const rows = await new Promise(resolve =>
            FractoIndexedTiles.load_short_codes('indexed', resolve),
         )
         assert.deepEqual(rows, ['12', '123'])
      })
   } finally {
      if (previous_mode === undefined) delete process.env.FRACTO_TILE_SOURCE_MODE
      else process.env.FRACTO_TILE_SOURCE_MODE = previous_mode
      if (previous_base_url === undefined) delete process.env.FRACTO_TILE_REMOTE_BASE_URL
      else process.env.FRACTO_TILE_REMOTE_BASE_URL = previous_base_url
   }
})

test('remote shortcode fetch failures mark the index build unsuccessful', async () => {
   const previous_mode = process.env.FRACTO_TILE_SOURCE_MODE
   const previous_base_url = process.env.FRACTO_TILE_REMOTE_BASE_URL
   const previous_exit_code = process.exitCode
   process.env.FRACTO_TILE_SOURCE_MODE = 'remote-cache'
   process.exitCode = undefined

   try {
      await with_server(request => request.socket.destroy(), async base_url => {
         process.env.FRACTO_TILE_REMOTE_BASE_URL = base_url
         const {FractoIndexedTiles} = await import('../sdk/FractoIndexedTiles.js')
         const rows = await new Promise(resolve =>
            FractoIndexedTiles.load_short_codes('indexed', resolve),
         )
         assert.deepEqual(rows, [])
         assert.equal(process.exitCode, 1)
      })
   } finally {
      process.exitCode = previous_exit_code
      if (previous_mode === undefined) delete process.env.FRACTO_TILE_SOURCE_MODE
      else process.env.FRACTO_TILE_SOURCE_MODE = previous_mode
      if (previous_base_url === undefined) delete process.env.FRACTO_TILE_REMOTE_BASE_URL
      else process.env.FRACTO_TILE_REMOTE_BASE_URL = previous_base_url
   }
})
