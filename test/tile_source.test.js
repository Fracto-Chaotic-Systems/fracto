import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import {spawnSync} from 'node:child_process'
import {after, test} from 'node:test'

import {
   read_source_tile,
   TileSourceError,
   tile_cache_identity,
   tile_source_path,
   validate_tile_source_release,
} from '../sdk/FractoTileSource.js'

const temporary_root = fs.mkdtempSync(path.join(os.tmpdir(), 'fracto-tile-source-'))
after(() => fs.rmSync(temporary_root, {recursive: true, force: true}))

test('resolves and decodes tiles using the authoritative level directory layout', () => {
   const source_directory = path.join(temporary_root, 'source')
   const tile_directory = path.join(source_directory, 'L02')
   fs.mkdirSync(tile_directory, {recursive: true})
   fs.writeFileSync(
      path.join(tile_directory, '12.gz'),
      zlib.gzipSync(JSON.stringify({short_code: '12', values: [1, 2, 3]})),
   )

   assert.equal(tile_source_path(source_directory, '12'), path.join(tile_directory, '12.gz'))
   assert.deepEqual(read_source_tile(source_directory, '12'), {
      short_code: '12',
      values: [1, 2, 3],
   })
})

test('rejects short codes that could escape the configured source tree', () => {
   assert.throws(() => tile_source_path(temporary_root, '../12'), /only digits/)
})

test('includes the source generation in local memory-cache identity', () => {
   assert.notEqual(
      tile_cache_identity('local', 'generation-1', '123'),
      tile_cache_identity('local', 'generation-2', '123'),
   )
   assert.equal(
      tile_cache_identity('remote-cache', null, '123'),
      tile_cache_identity('remote-cache', null, '123'),
   )
})

test('binds a source generation to its exact compiled index fingerprint and tile count', () => {
   const source_directory = path.join(temporary_root, 'paired-release')
   fs.mkdirSync(source_directory, {recursive: true})
   const index_metadata = {fingerprint: 'a'.repeat(64), tile_count: 42}
   const manifest = {
      schema_version: 2,
      source_generation: 'release-2026-09',
      index_fingerprint: index_metadata.fingerprint,
      index_tile_count: index_metadata.tile_count,
      tile_inventory: {
         method: 'exact-short-code-set-v1',
         verified_tile_count: index_metadata.tile_count,
      },
   }
   fs.writeFileSync(
      path.join(source_directory, 'fracto-tile-release.json'),
      JSON.stringify(manifest),
   )

   assert.deepEqual(validate_tile_source_release({
      source_directory,
      source_generation: 'release-2026-09',
      index_metadata,
   }), manifest)
   assert.throws(
      () => validate_tile_source_release({
         source_directory,
         source_generation: 'release-2026-09',
         index_metadata: {...index_metadata, fingerprint: 'b'.repeat(64)},
      }),
      /fingerprint does not match/,
   )
   assert.throws(
      () => validate_tile_source_release({
         source_directory,
         source_generation: 'another-release',
         index_metadata,
      }),
      /generation does not match/,
   )
})

test('requires a generation identifier in local-source mode', () => {
   const result = spawnSync(process.execPath, [
      '--input-type=module',
      '-e',
      "await import('./sdk/FractoTilePaths.js')",
   ], {
      cwd: path.resolve(import.meta.dirname, '..'),
      encoding: 'utf8',
      env: {
         ...process.env,
         FRACTO_TILE_SOURCE_MODE: 'local',
         FRACTO_TILE_SOURCE_DIR: temporary_root,
         FRACTO_TILE_SOURCE_GENERATION: '',
      },
   })

   assert.notEqual(result.status, 0)
   assert.match(result.stderr, /FRACTO_TILE_SOURCE_GENERATION is required/)
})

test('reports missing and invalid authoritative files without exposing filesystem paths', () => {
   const source_directory = path.join(temporary_root, 'errors')
   assert.throws(
      () => read_source_tile(source_directory, '123'),
      error => error instanceof TileSourceError && error.code === 'TILE_SOURCE_MISSING',
   )

   const tile_directory = path.join(source_directory, 'L03')
   fs.mkdirSync(tile_directory, {recursive: true})
   fs.writeFileSync(path.join(tile_directory, '123.gz'), 'not gzip data')
   assert.throws(
      () => read_source_tile(source_directory, '123'),
      error => error instanceof TileSourceError && error.code === 'TILE_SOURCE_INVALID_GZIP',
   )

   const invalid_json = zlib.gzipSync('{invalid json')
   fs.writeFileSync(path.join(tile_directory, '123.gz'), invalid_json)
   assert.throws(
      () => read_source_tile(source_directory, '123'),
      error => error instanceof TileSourceError
         && error.code === 'TILE_SOURCE_INVALID_JSON'
         && !error.message.includes(source_directory),
   )

   fs.mkdirSync(path.join(tile_directory, '124.gz'))
   assert.throws(
      () => read_source_tile(source_directory, '124'),
      error => error instanceof TileSourceError && error.kind === 'unreadable',
   )
})

test('maps a source permission failure to an unreadable tile error', () => {
   const source_directory = path.join(temporary_root, 'permission-source')
   const tile_path = tile_source_path(source_directory, '12')
   const original_read_file_sync = fs.readFileSync
   fs.readFileSync = file_path => {
      if (file_path === tile_path) {
         const error = new Error('permission denied')
         error.code = 'EACCES'
         throw error
      }
      return original_read_file_sync(file_path)
   }
   try {
      assert.throws(
         () => read_source_tile(source_directory, '12'),
         error => error instanceof TileSourceError
            && error.code === 'TILE_SOURCE_UNREADABLE'
            && error.kind === 'unreadable',
      )
   } finally {
      fs.readFileSync = original_read_file_sync
   }
})

test('local-source tile loading uses memory without network or demand-cache writes', () => {
   const source_directory = path.join(temporary_root, 'local-source')
   const tile_directory = path.join(source_directory, 'L02')
   const demand_cache_directory = path.join(temporary_root, 'must-not-be-created')
   fs.mkdirSync(tile_directory, {recursive: true})
   fs.writeFileSync(
      path.join(tile_directory, '12.gz'),
      zlib.gzipSync(JSON.stringify({short_code: '12', values: [4, 5, 6]})),
   )

   const script = [
      "import https from 'node:https'",
      "https.get = () => { throw new Error('unexpected network request') }",
      "const {FractoTileCache} = await import('./sdk/FractoTileCache.js')",
      "const first = await FractoTileCache.get_tile('12')",
      "const second = await FractoTileCache.get_tile('12')",
      "let missing = null; try { await FractoTileCache.get_tile('13') } catch (error) { missing = {code: error.code, kind: error.kind, short_code: error.short_code, message: error.message} }",
      "const {raster_fill_turbo} = await import('./sdk/FractoTileData.js')",
      "let render_failure = null; try { await raster_fill_turbo([[[0, 4]]], [{level: 2, tile_increment: 2, level_tiles: [{short_code: '13', bounds: {left: -1, right: 1, bottom: -1, top: 1}}]}], 1, {x: 0, y: 0}, 2, 1) } catch (error) { render_failure = {code: error.code, kind: error.kind, short_code: error.short_code} }",
      "console.log('RESULT:' + JSON.stringify({first, second, missing, render_failure, stats: FractoTileCache.get_stats()}))",
   ].join(';')
   const index_directory = path.join(temporary_root, 'tile-index')
   fs.mkdirSync(index_directory, {recursive: true})
   const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: path.resolve(import.meta.dirname, '..'),
      encoding: 'utf8',
      env: {
         ...process.env,
         FRACTO_TILE_SOURCE_MODE: 'local',
         FRACTO_TILE_SOURCE_DIR: source_directory,
         FRACTO_TILE_SOURCE_GENERATION: 'test-generation-1',
         FRACTO_TILE_DATA_DIR: demand_cache_directory,
         FRACTO_TILE_INDEX_DIR: index_directory,
      },
   })

   assert.equal(result.status, 0, result.stderr)
   const output = result.stdout.split('\n').find(line => line.startsWith('RESULT:'))
   assert.ok(output, result.stdout)
   const {first, second, missing, render_failure, stats} = JSON.parse(output.slice('RESULT:'.length))
   assert.deepEqual(first, {short_code: '12', values: [4, 5, 6]})
   assert.deepEqual(second, first)
   assert.deepEqual(missing, {
      code: 'TILE_SOURCE_MISSING',
      kind: 'missing',
      short_code: '13',
      message: 'Authoritative tile 13 is missing',
   })
   assert.deepEqual(render_failure, {
      code: 'TILE_SOURCE_MISSING',
      kind: 'missing',
      short_code: '13',
   })
   assert.equal(stats.memory_hits, 1)
   assert.equal(stats.disk_hits, 0)
   assert.equal(stats.downloads, 0)
   assert.equal(stats.local_source_reads, 1)
   assert.equal(stats.local_source_failures, 2)
   assert.equal(stats.failures, 2)
   assert.equal(stats.source_mode, 'local')
   assert.equal(stats.source_generation, 'test-generation-1')
   assert.equal(stats.read_only, true)
   assert.deepEqual(stats.last_source_error.code, 'TILE_SOURCE_MISSING')
   assert.equal(JSON.stringify(stats).includes(source_directory), false)
   assert.equal(Object.hasOwn(stats, 'cache_directory'), false)
   assert.equal(fs.existsSync(demand_cache_directory), false)
})

test('local corrupt or unreadable tiles fail without network fallback or cache writes', () => {
   const source_directory = path.join(temporary_root, 'local-invalid-source')
   const level_directory = path.join(source_directory, 'L02')
   const demand_cache_directory = path.join(temporary_root, 'invalid-source-demand-cache')
   fs.mkdirSync(level_directory, {recursive: true})
   fs.writeFileSync(path.join(level_directory, '12.gz'), 'not gzip data')
   fs.writeFileSync(path.join(level_directory, '13.gz'), zlib.gzipSync('{invalid json'))
   fs.writeFileSync(path.join(level_directory, '14.gz'), zlib.gzipSync('{"short_code":"14"}'))

   const script = [
      "import fs from 'node:fs'",
      "import https from 'node:https'",
      'let network_calls = 0',
      "https.get = () => { network_calls++; throw new Error('network fallback attempted') }",
      'const unreadable_path = process.env.TEST_UNREADABLE_TILE',
      'const original_read_file_sync = fs.readFileSync',
      "fs.readFileSync = (filepath, ...args) => { if (String(filepath) === unreadable_path) { const error = new Error('permission denied'); error.code = 'EACCES'; throw error } return original_read_file_sync(filepath, ...args) }",
      "const {FractoTileCache} = await import('./sdk/FractoTileCache.js')",
      "const outcomes = {}; for (const short_code of ['12', '13', '14']) { try { await FractoTileCache.get_tile(short_code); outcomes[short_code] = null } catch (error) { outcomes[short_code] = {code: error.code, kind: error.kind} } }",
      "console.log('RESULT:' + JSON.stringify({outcomes, network_calls, stats: FractoTileCache.get_stats()}))",
   ].join(';')
   const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: path.resolve(import.meta.dirname, '..'),
      encoding: 'utf8',
      env: {
         ...process.env,
         FRACTO_TILE_SOURCE_MODE: 'local',
         FRACTO_TILE_SOURCE_DIR: source_directory,
         FRACTO_TILE_SOURCE_GENERATION: 'invalid-source-generation',
         FRACTO_TILE_DATA_DIR: demand_cache_directory,
         FRACTO_TILE_MIN_FREE_BYTES: '0',
         TEST_UNREADABLE_TILE: path.join(level_directory, '14.gz'),
      },
   })

   assert.equal(result.status, 0, result.stderr)
   const output = result.stdout.split('\n').find(line => line.startsWith('RESULT:'))
   assert.ok(output, result.stdout)
   const {outcomes, network_calls, stats} = JSON.parse(output.slice('RESULT:'.length))
   assert.deepEqual(outcomes, {
      12: {code: 'TILE_SOURCE_INVALID_GZIP', kind: 'invalid_gzip'},
      13: {code: 'TILE_SOURCE_INVALID_JSON', kind: 'invalid_json'},
      14: {code: 'TILE_SOURCE_UNREADABLE', kind: 'unreadable'},
   })
   assert.equal(network_calls, 0)
   assert.equal(stats.downloads, 0)
   assert.equal(stats.disk_hits, 0)
   assert.equal(stats.local_source_reads, 0)
   assert.equal(stats.local_source_failures, 3)
   assert.equal(stats.failures, 3)
   assert.equal(fs.existsSync(demand_cache_directory), false)
})

test('memory trimming waits for the minimum population and evicts idle entries at its threshold', () => {
   const source_directory = path.join(temporary_root, 'eviction-source')
   const level_directory = path.join(source_directory, 'L06')
   fs.mkdirSync(level_directory, {recursive: true})
   const tile_data = zlib.gzipSync(JSON.stringify([[ [1, 2] ]]))
   for (let index = 0; index < 750; index++) {
      const short_code = String(100000 + index)
      fs.writeFileSync(path.join(level_directory, `${short_code}.gz`), tile_data)
   }

   const script = [
      "const {FractoTileCache} = await import('./sdk/FractoTileCache.js')",
      "for (let index = 0; index < 749; index++) await FractoTileCache.get_tile(String(100000 + index))",
      'FractoTileCache.trim_cache(180000)',
      'const below_threshold = FractoTileCache.get_stats()',
      "await FractoTileCache.get_tile('100749')",
      'FractoTileCache.trim_cache(180000)',
      "console.log('RESULT:' + JSON.stringify({below_threshold, after_trim: FractoTileCache.get_stats()}))",
   ].join(';')
   const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: path.resolve(import.meta.dirname, '..'),
      encoding: 'utf8',
      env: {
         ...process.env,
         FRACTO_TILE_SOURCE_MODE: 'local',
         FRACTO_TILE_SOURCE_DIR: source_directory,
         FRACTO_TILE_SOURCE_GENERATION: 'eviction-generation',
      },
   })

   assert.equal(result.status, 0, result.stderr)
   const output = result.stdout.split('\n').find(line => line.startsWith('RESULT:'))
   assert.ok(output, result.stdout)
   const {below_threshold, after_trim} = JSON.parse(output.slice('RESULT:'.length))
   assert.equal(below_threshold.in_memory, 749)
   assert.equal(below_threshold.evictions, 0)
   assert.equal(after_trim.in_memory, 0)
   assert.equal(after_trim.evictions, 750)
})

test('restarting with a new source generation reads the new immutable dataset', () => {
   const first_source = path.join(temporary_root, 'generation-one')
   const second_source = path.join(temporary_root, 'generation-two')
   for (const [source_directory, value] of [[first_source, 1], [second_source, 2]]) {
      const tile_directory = path.join(source_directory, 'L02')
      fs.mkdirSync(tile_directory, {recursive: true})
      fs.writeFileSync(
         path.join(tile_directory, '12.gz'),
         zlib.gzipSync(JSON.stringify({short_code: '12', generation_value: value})),
      )
   }
   const script = [
      "const {FractoTileCache} = await import('./sdk/FractoTileCache.js')",
      "const tile = await FractoTileCache.get_tile('12')",
      "console.log('RESULT:' + JSON.stringify({tile, stats: FractoTileCache.get_stats()}))",
   ].join(';')
   const read_generation = (source_directory, generation) => {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
         cwd: path.resolve(import.meta.dirname, '..'),
         encoding: 'utf8',
         env: {
            ...process.env,
            FRACTO_TILE_SOURCE_MODE: 'local',
            FRACTO_TILE_SOURCE_DIR: source_directory,
            FRACTO_TILE_SOURCE_GENERATION: generation,
         },
      })
      assert.equal(result.status, 0, result.stderr)
      const output = result.stdout.split('\n').find(line => line.startsWith('RESULT:'))
      assert.ok(output, result.stdout)
      return JSON.parse(output.slice('RESULT:'.length))
   }

   const generation_one = read_generation(first_source, 'generation-one')
   const generation_two = read_generation(second_source, 'generation-two')
   assert.equal(generation_one.tile.generation_value, 1)
   assert.equal(generation_two.tile.generation_value, 2)
   assert.equal(generation_one.stats.source_generation, 'generation-one')
   assert.equal(generation_two.stats.source_generation, 'generation-two')
})

test('remote-cache mode still downloads once, persists the tile, and serves later from disk', () => {
   const cache_directory = path.join(temporary_root, 'remote-demand-cache')
   const fixture_directory = path.join(temporary_root, 'remote-response')
   fs.mkdirSync(fixture_directory, {recursive: true})
   const fixture_path = path.join(fixture_directory, '12.gz')
   fs.writeFileSync(
      fixture_path,
      zlib.gzipSync(JSON.stringify({short_code: '12', values: [7, 8, 9]})),
   )
   const download_script = [
      "import fs from 'node:fs'",
      "import https from 'node:https'",
      "import {EventEmitter} from 'node:events'",
      "import {Readable} from 'node:stream'",
      'let http_calls = 0',
      "const payload = fs.readFileSync(process.env.TEST_TILE_FIXTURE)",
      "https.get = (url, callback) => { http_calls++; const request = new EventEmitter(); process.nextTick(() => { const response = Readable.from([payload]); response.statusCode = 200; callback(response) }); return request }",
      "const {FractoTileCache} = await import('./sdk/FractoTileCache.js')",
      "const tile = await FractoTileCache.get_tile('12')",
      "console.log('RESULT:' + JSON.stringify({tile, http_calls, stats: FractoTileCache.get_stats()}))",
   ].join(';')
   const download_result = spawnSync(process.execPath, ['--input-type=module', '-e', download_script], {
      cwd: path.resolve(import.meta.dirname, '..'),
      encoding: 'utf8',
      env: {
         ...process.env,
         FRACTO_TILE_SOURCE_MODE: 'remote-cache',
         FRACTO_TILE_DATA_DIR: cache_directory,
         FRACTO_TILE_CACHE_READ_ONLY: 'false',
         FRACTO_TILE_MIN_FREE_BYTES: '0',
         TEST_TILE_FIXTURE: fixture_path,
      },
   })
   assert.equal(download_result.status, 0, download_result.stderr)
   const download_output = download_result.stdout.split('\n').find(line => line.startsWith('RESULT:'))
   assert.ok(download_output, download_result.stdout)
   const downloaded = JSON.parse(download_output.slice('RESULT:'.length))
   assert.equal(downloaded.tile.values[2], 9)
   assert.equal(downloaded.http_calls, 1)
   assert.equal(downloaded.stats.downloads, 1)
   assert.equal(fs.existsSync(path.join(cache_directory, '12.gz')), true)

   const disk_script = [
      "import https from 'node:https'",
      "https.get = () => { throw new Error('unexpected remote fallback for cached tile') }",
      "const {FractoTileCache} = await import('./sdk/FractoTileCache.js')",
      "const tile = await FractoTileCache.get_tile('12')",
      "console.log('RESULT:' + JSON.stringify({tile, stats: FractoTileCache.get_stats()}))",
   ].join(';')
   const disk_result = spawnSync(process.execPath, ['--input-type=module', '-e', disk_script], {
      cwd: path.resolve(import.meta.dirname, '..'),
      encoding: 'utf8',
      env: {
         ...process.env,
         FRACTO_TILE_SOURCE_MODE: 'remote-cache',
         FRACTO_TILE_DATA_DIR: cache_directory,
         FRACTO_TILE_CACHE_READ_ONLY: 'false',
      },
   })
   assert.equal(disk_result.status, 0, disk_result.stderr)
   const disk_output = disk_result.stdout.split('\n').find(line => line.startsWith('RESULT:'))
   assert.ok(disk_output, disk_result.stdout)
   const disk_loaded = JSON.parse(disk_output.slice('RESULT:'.length))
   assert.equal(disk_loaded.tile.values[0], 7)
   assert.equal(disk_loaded.stats.disk_hits, 1)
   assert.equal(disk_loaded.stats.downloads, 0)
})
