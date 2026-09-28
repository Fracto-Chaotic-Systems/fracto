import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import {spawnSync} from 'node:child_process'
import {after, test} from 'node:test'

const repository_root = path.resolve(import.meta.dirname, '..')
const temporary_root = fs.mkdtempSync(path.join(os.tmpdir(), 'fracto-local-tile-start-'))
const index_directory = path.join(temporary_root, 'index')
const source_directory = path.join(temporary_root, 'source')
const tile_short_code = '12'

after(() => fs.rmSync(temporary_root, {recursive: true, force: true}))

const run_node = (args, env) => spawnSync(process.execPath, args, {
   cwd: repository_root,
   encoding: 'utf8',
   env: {...process.env, ...env},
})

const prepare_fixture = () => {
   const index_source_directory = path.join(index_directory, 'manifest', 'indexed')
   fs.mkdirSync(index_source_directory, {recursive: true})
   fs.mkdirSync(path.join(source_directory, 'L02'), {recursive: true})
   fs.writeFileSync(
      path.join(index_source_directory, 'tile_packet_bin_indexed_level_02.json'),
      JSON.stringify({
         level: 2,
         columns: [{left: 0, tiles: [{short_code: tile_short_code, bottom: 0}]}],
      }),
   )
   fs.writeFileSync(
      path.join(index_source_directory, 'packet_manifest.json'),
      JSON.stringify({packet_files: ['tile_packet_bin_indexed_level_02.json'], tile_count: 1}),
   )
   const tile_data = Array.from({length: 256}, () =>
      Array.from({length: 256}, () => [1, 2]),
   )
   fs.writeFileSync(
      path.join(source_directory, 'L02', `${tile_short_code}.gz`),
      zlib.gzipSync(JSON.stringify(tile_data)),
   )

   const build = run_node([
      '--input-type=module',
      '-e',
      "import {build_tile_index_cache} from './sdk/FractoTileIndexCache.js'; build_tile_index_cache()",
   ], {
      FRACTO_TILE_SOURCE_MODE: 'local',
      FRACTO_TILE_SOURCE_DIR: source_directory,
      FRACTO_TILE_SOURCE_GENERATION: 'test-generation-1',
      FRACTO_TILE_INDEX_DIR: index_directory,
   })
   assert.equal(build.status, 0, build.stderr)

   const release = run_node(['scripts/create_tile_source_release_manifest.js'], {
      FRACTO_TILE_SOURCE_MODE: 'local',
      FRACTO_TILE_SOURCE_DIR: source_directory,
      FRACTO_TILE_SOURCE_GENERATION: 'test-generation-1',
      FRACTO_TILE_INDEX_DIR: index_directory,
   })
   assert.equal(release.status, 0, release.stderr)
   assert.match(release.stdout, /Created fracto-tile-release\.json/)
}

prepare_fixture()

const local_environment = {
   FRACTO_TILE_SOURCE_MODE: 'local',
   FRACTO_TILE_SOURCE_DIR: source_directory,
   FRACTO_TILE_SOURCE_GENERATION: 'test-generation-1',
   FRACTO_TILE_INDEX_DIR: index_directory,
}

test('dedicated command validates the source and compiled index before service start', () => {
   const result = run_node(
      ['scripts/start_tiles_local_source.js', '--check'],
      local_environment,
   )
   assert.equal(result.status, 0, result.stderr)
   assert.match(result.stdout, /preflight passed/)
   assert.match(result.stdout, /1 compiled packets/)
   assert.match(result.stdout, /representative tile 12/)
})

test('root supervisor preflight validates the mounted source, decoded tile, and index pairing', () => {
   const valid_pair = run_node([
      '--input-type=module',
      '-e',
      "import {validate_local_tile_source} from './scripts/startup_preflight.js'; const result = await validate_local_tile_source(); console.log('PAIR_OK:' + result.representative_short_code)",
   ], local_environment)
   assert.equal(valid_pair.status, 0, valid_pair.stderr)
   assert.match(valid_pair.stdout, /PAIR_OK:12/)

   const mismatch_source = path.join(temporary_root, 'supervisor-mismatched-pair')
   fs.cpSync(source_directory, mismatch_source, {recursive: true})
   const manifest_path = path.join(mismatch_source, 'fracto-tile-release.json')
   const manifest = JSON.parse(fs.readFileSync(manifest_path, 'utf8'))
   manifest.index_tile_count++
   fs.writeFileSync(manifest_path, JSON.stringify(manifest))
   const invalid_pair = run_node([
      '--input-type=module',
      '-e',
      "import {validate_local_tile_source} from './scripts/startup_preflight.js'; await validate_local_tile_source()",
   ], {...local_environment, FRACTO_TILE_SOURCE_DIR: mismatch_source})
   assert.notEqual(invalid_pair.status, 0)
   assert.match(invalid_pair.stderr, /tile count does not match/)
})

test('root supervisor preflight rejects an unreadable or absent tile mount with guidance', () => {
   const missing_source = path.join(temporary_root, 'supervisor-absent-source')
   const result = run_node([
      '--input-type=module',
      '-e',
      "import {validate_local_tile_source} from './scripts/startup_preflight.js'; await validate_local_tile_source()",
   ], {...local_environment, FRACTO_TILE_SOURCE_DIR: missing_source})
   assert.notEqual(result.status, 0)
   assert.match(result.stderr, /FRACTO_TILE_SOURCE_DIR is missing or not readable or searchable/)
   assert.match(result.stderr, /grant the service user read and directory-search permissions/)
})

test('root supervisor preflight reports an unreadable local tile mount', () => {
   const script = [
      "import fs from 'node:fs'",
      'const original_access_sync = fs.accessSync',
      "fs.accessSync = (filepath, ...args) => { if (String(filepath) === process.env.FRACTO_TILE_SOURCE_DIR) { const error = new Error('permission denied'); error.code = 'EACCES'; throw error } return original_access_sync(filepath, ...args) }",
      "const {validate_local_tile_source} = await import('./scripts/startup_preflight.js')",
      'try { await validate_local_tile_source() } catch (error) { console.error(error.message); process.exitCode = 1 }',
   ].join(';')
   const result = run_node(['--input-type=module', '-e', script], local_environment)

   assert.notEqual(result.status, 0)
   assert.match(result.stderr, /FRACTO_TILE_SOURCE_DIR is missing or not readable or searchable/)
   assert.match(result.stderr, /grant the service user read and directory-search permissions/)
})

test('dedicated command fails actionably when the indexed representative tile is missing', () => {
   const missing_source = path.join(temporary_root, 'source-missing-tile')
   fs.mkdirSync(path.join(missing_source, 'L02'), {recursive: true})
   fs.copyFileSync(
      path.join(source_directory, 'fracto-tile-release.json'),
      path.join(missing_source, 'fracto-tile-release.json'),
   )
   const result = run_node(
      ['scripts/start_tiles_local_source.js', '--check'],
      {...local_environment, FRACTO_TILE_SOURCE_DIR: missing_source},
   )
   assert.notEqual(result.status, 0)
   assert.match(result.stderr, /missing indexed representative tile 12 under L02/)
})

test('dedicated command rejects an unexpected source-directory layout', () => {
   const invalid_source = path.join(temporary_root, 'source-invalid-layout')
   fs.mkdirSync(path.join(invalid_source, 'level-02'), {recursive: true})
   const result = run_node(
      ['scripts/start_tiles_local_source.js', '--check'],
      {...local_environment, FRACTO_TILE_SOURCE_DIR: invalid_source},
   )
   assert.notEqual(result.status, 0)
   assert.match(result.stderr, /expected level directories named LNN/)
})

test('dedicated command reports a missing compiled index generation', () => {
   const missing_index = path.join(temporary_root, 'missing-index')
   fs.mkdirSync(missing_index, {recursive: true})
   const result = run_node(
      ['scripts/start_tiles_local_source.js', '--check'],
      {...local_environment, FRACTO_TILE_INDEX_DIR: missing_index},
   )
   assert.notEqual(result.status, 0)
   assert.match(result.stderr, /Compiled tile index preflight failed/)
})

test('dedicated command rejects a missing generation identifier before launch', () => {
   const result = run_node(
      ['scripts/start_tiles_local_source.js', '--check'],
      {...local_environment, FRACTO_TILE_SOURCE_GENERATION: ''},
   )
   assert.notEqual(result.status, 0)
   assert.match(result.stderr, /Set FRACTO_TILE_SOURCE_GENERATION/)
})

test('dedicated command rejects a source manifest paired with another index', () => {
   const mismatched_source = path.join(temporary_root, 'source-mismatched-index')
   fs.cpSync(source_directory, mismatched_source, {recursive: true})
   const manifest_path = path.join(mismatched_source, 'fracto-tile-release.json')
   const manifest = JSON.parse(fs.readFileSync(manifest_path, 'utf8'))
   manifest.index_fingerprint = '0'.repeat(64)
   fs.writeFileSync(manifest_path, JSON.stringify(manifest))

   const result = run_node(
      ['scripts/start_tiles_local_source.js', '--check'],
      {...local_environment, FRACTO_TILE_SOURCE_DIR: mismatched_source},
   )
   assert.notEqual(result.status, 0)
   assert.match(result.stderr, /index fingerprint does not match/)
})

test('dedicated command rejects a source generation without its release manifest', () => {
   const unpaired_source = path.join(temporary_root, 'source-without-release-manifest')
   fs.cpSync(source_directory, unpaired_source, {recursive: true})
   fs.rmSync(path.join(unpaired_source, 'fracto-tile-release.json'))
   const result = run_node(
      ['scripts/start_tiles_local_source.js', '--check'],
      {...local_environment, FRACTO_TILE_SOURCE_DIR: unpaired_source},
   )
   assert.notEqual(result.status, 0)
   assert.match(result.stderr, /manifest is missing or invalid/)
})

test('dedicated command rejects an index compiled for another source generation', () => {
   const result = run_node(
      ['scripts/start_tiles_local_source.js', '--check'],
      {...local_environment, FRACTO_TILE_SOURCE_GENERATION: 'different-generation'},
   )
   assert.notEqual(result.status, 0)
   assert.match(result.stderr, /not built for FRACTO_TILE_SOURCE_GENERATION/)
})

test('release manifest command refuses to replace a published manifest', () => {
   const result = run_node(
      ['scripts/create_tile_source_release_manifest.js'],
      {
         FRACTO_TILE_SOURCE_MODE: 'local',
         FRACTO_TILE_SOURCE_DIR: source_directory,
         FRACTO_TILE_SOURCE_GENERATION: 'test-generation-1',
         FRACTO_TILE_INDEX_DIR: index_directory,
      },
   )
   assert.notEqual(result.status, 0)
   assert.match(result.stderr, /already exists/)
})

test('release manifest creation does not scan the corpus inventory', () => {
   const extra_tile_source = path.join(temporary_root, 'source-with-extra-tile')
   fs.cpSync(source_directory, extra_tile_source, {recursive: true})
   fs.rmSync(path.join(extra_tile_source, 'fracto-tile-release.json'))
   fs.writeFileSync(
      path.join(extra_tile_source, 'L02', '13.gz'),
      zlib.gzipSync(JSON.stringify(Array.from({length: 256}, () =>
         Array.from({length: 256}, () => [1, 2]),
      ))),
   )
   const result = run_node(['scripts/create_tile_source_release_manifest.js'], {
      ...local_environment,
      FRACTO_TILE_SOURCE_DIR: extra_tile_source,
   })
   assert.equal(result.status, 0, result.stderr)
   const manifest = JSON.parse(fs.readFileSync(
      path.join(extra_tile_source, 'fracto-tile-release.json'),
      'utf8',
   ))
   assert.equal(manifest.schema_version, 3)
   assert.deepEqual(manifest.tile_validation, {
      method: 'representative-tile-shape-v1',
      short_code: tile_short_code,
   })
})

test('dedicated command fails actionably when the source directory is missing', () => {
   const result = run_node(
      ['scripts/start_tiles_local_source.js', '--check'],
      {...local_environment, FRACTO_TILE_SOURCE_DIR: path.join(temporary_root, 'absent-source')},
   )
   assert.notEqual(result.status, 0)
   assert.match(result.stderr, /not readable or searchable/)
})

test('dedicated command requires an explicit source directory', () => {
   const result = run_node(
      ['scripts/start_tiles_local_source.js', '--check'],
      {...local_environment, FRACTO_TILE_SOURCE_DIR: ''},
   )
   assert.notEqual(result.status, 0)
   assert.match(result.stderr, /Set FRACTO_TILE_SOURCE_DIR/)
})
