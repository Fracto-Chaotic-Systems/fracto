import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {after, test} from 'node:test'

const repository_root = path.resolve(import.meta.dirname, '..')
const temporary_root = fs.mkdtempSync(path.join(os.tmpdir(), 'fracto-index-release-'))
const index_root = path.join(temporary_root, 'index')
const generations_directory = path.join(index_root, 'generations')
const run_selector = generation => spawnSync(process.execPath, [
   'scripts/select_tile_index_generation.js', generation,
], {
   cwd: repository_root,
   encoding: 'utf8',
   env: {...process.env, FRACTO_TILE_INDEX_DIR: index_root},
})

after(() => fs.rmSync(temporary_root, {recursive: true, force: true}))

test('selects a complete staged index atomically and preserves the previous generation', () => {
   fs.mkdirSync(path.join(generations_directory, 'previous'), {recursive: true})
   fs.mkdirSync(path.join(generations_directory, 'candidate'), {recursive: true})
   fs.writeFileSync(path.join(generations_directory, 'previous', 'COMPLETE'), 'ok\n')
   fs.writeFileSync(path.join(generations_directory, 'candidate', 'COMPLETE'), 'ok\n')
   fs.writeFileSync(path.join(index_root, 'CURRENT'), 'previous\n')

   const result = run_selector('candidate')
   assert.equal(result.status, 0, result.stderr)
   assert.equal(fs.readFileSync(path.join(index_root, 'CURRENT'), 'utf8'), 'candidate\n')
   assert.equal(fs.existsSync(path.join(generations_directory, 'previous', 'COMPLETE')), true)
   assert.match(result.stdout, /previous: previous/)
})

test('refuses incomplete candidates and an active index refresh', () => {
   fs.mkdirSync(path.join(generations_directory, 'incomplete'), {recursive: true})
   let result = run_selector('incomplete')
   assert.notEqual(result.status, 0)
   assert.match(result.stderr, /missing or incomplete/)

   fs.writeFileSync(path.join(generations_directory, 'incomplete', 'COMPLETE'), 'ok\n')
   fs.writeFileSync(path.join(index_root, 'REFRESH.lock'), '{"pid":1}\n')
   result = run_selector('incomplete')
   assert.notEqual(result.status, 0)
   assert.match(result.stderr, /refresh or generation switch is in progress/)
   assert.equal(fs.readFileSync(path.join(index_root, 'CURRENT'), 'utf8'), 'candidate\n')
})
