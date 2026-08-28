import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {after, describe, test} from 'node:test'

const temporary_root = fs.mkdtempSync(path.join(os.tmpdir(), 'fracto-tile-paths-'))
after(() => fs.rmSync(temporary_root, {recursive: true, force: true}))

describe('tile index generations', () => {
   test('resolves only the published completed generation', () => {
      const generation = 'generation-1'
      const generation_directory = path.join(temporary_root, 'generations', generation)
      fs.mkdirSync(generation_directory, {recursive: true})
      fs.writeFileSync(path.join(generation_directory, 'COMPLETE'), 'complete\n')
      fs.writeFileSync(path.join(temporary_root, 'CURRENT'), `${generation}\n`)

      const script = [
         "import {tile_index_paths} from './sdk/FractoTilePaths.js'",
         'console.log(JSON.stringify(tile_index_paths()))',
      ].join(';')
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
         cwd: path.join(import.meta.dirname, '..'),
         encoding: 'utf8',
         env: {...process.env, FRACTO_TILE_INDEX_DIR: temporary_root},
      })

      assert.equal(result.status, 0, result.stderr)
      const resolved = JSON.parse(result.stdout)
      assert.equal(resolved.base, generation_directory)
      assert.equal(resolved.source, path.join(generation_directory, 'manifest', 'indexed'))
      assert.equal(resolved.cache, path.join(generation_directory, 'cache', 'indexed'))
   })

   test('rejects a published generation without a completion marker', () => {
      fs.writeFileSync(path.join(temporary_root, 'CURRENT'), 'incomplete\n')
      const script = [
         "import {tile_index_paths} from './sdk/FractoTilePaths.js'",
         'tile_index_paths()',
      ].join(';')
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
         cwd: path.join(import.meta.dirname, '..'),
         encoding: 'utf8',
         env: {...process.env, FRACTO_TILE_INDEX_DIR: temporary_root},
      })

      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /is not complete/)
   })
})
