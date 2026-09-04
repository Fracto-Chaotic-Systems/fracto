import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'

import {
   TILE_INDEX_CURRENT_FILE,
   TILE_INDEX_GENERATIONS_DIRECTORY,
   TILE_INDEX_ROOT,
   tile_index_generation_directory,
} from '../sdk/FractoTilePaths.js'

const retention_count = Number(process.env.FRACTO_TILE_INDEX_GENERATIONS_TO_KEEP || 2)
if (!Number.isInteger(retention_count) || retention_count < 1) {
   throw new Error('FRACTO_TILE_INDEX_GENERATIONS_TO_KEEP must be a positive integer')
}

fs.mkdirSync(TILE_INDEX_GENERATIONS_DIRECTORY, {recursive: true})
const lock_file = path.join(TILE_INDEX_ROOT, 'REFRESH.lock')
let lock_handle
let generation_directory
let published = false

const acquire_lock = () => {
   const owner = {hostname: process.env.HOSTNAME || 'local', pid: process.pid}
   if (fs.existsSync(lock_file)) {
      try {
         const existing = JSON.parse(fs.readFileSync(lock_file, 'utf8'))
         const same_host = existing.hostname === owner.hostname
         const process_exists = same_host && fs.existsSync(`/proc/${existing.pid}`)
         if (process_exists) {
            throw new Error(`Tile index refresh is already running as PID ${existing.pid}`)
         }
         console.warn(`Removing stale tile index refresh lock from ${existing.hostname}:${existing.pid}`)
         fs.rmSync(lock_file, {force: true})
      } catch (error) {
         if (error.message.startsWith('Tile index refresh is already running')) throw error
         fs.rmSync(lock_file, {force: true})
      }
   }
   const handle = fs.openSync(lock_file, 'wx')
   fs.writeFileSync(handle, `${JSON.stringify(owner)}\n`)
   return handle
}

const run = (cwd, args, env) => {
   const result = spawnSync(process.execPath, args, {
      cwd,
      env: {...process.env, ...env},
      stdio: 'inherit',
      shell: false,
   })
   if (result.status !== 0) {
      throw new Error(`${args.join(' ')} exited with code ${result.status}`)
   }
}

const publish_current = generation => {
   const temporary = `${TILE_INDEX_CURRENT_FILE}.tmp-${process.pid}`
   fs.writeFileSync(temporary, `${generation}\n`, {flag: 'wx'})
   fs.renameSync(temporary, TILE_INDEX_CURRENT_FILE)
}

const prune_generations = current_generation => {
   const completed = fs.readdirSync(TILE_INDEX_GENERATIONS_DIRECTORY, {withFileTypes: true})
      .filter(entry => entry.isDirectory())
      .map(entry => ({
         name: entry.name,
         directory: tile_index_generation_directory(entry.name),
      }))
      .filter(item => fs.existsSync(path.join(item.directory, 'COMPLETE')))
      .sort((a, b) => fs.statSync(b.directory).mtimeMs - fs.statSync(a.directory).mtimeMs)

   const keep = new Set([
      current_generation,
      ...completed.slice(0, retention_count).map(item => item.name),
   ])
   completed.filter(item => !keep.has(item.name)).forEach(item => {
      fs.rmSync(item.directory, {recursive: true, force: true})
      console.log(`Removed old tile index generation ${item.name}`)
   })
}

try {
   lock_handle = acquire_lock()

   const generation = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
   generation_directory = tile_index_generation_directory(generation)
   fs.mkdirSync(generation_directory, {recursive: false})
   const generation_env = {FRACTO_TILE_INDEX_GENERATION_DIR: generation_directory}

   console.log(`Building tile index generation ${generation}`)
   run(
      path.join(import.meta.dirname, '..', 'servers', 'fracto-tiles-server'),
      ['tile_indexer.js', 'indexed'],
      generation_env,
   )
   run(path.join(import.meta.dirname, '..'), ['scripts/build_tile_index.js'], generation_env)
   run(path.join(import.meta.dirname, '..'), ['scripts/build_coverage_cache.js'], generation_env)

   fs.writeFileSync(path.join(generation_directory, 'COMPLETE'), `${new Date().toISOString()}\n`)
   publish_current(generation)
   published = true
   console.log(`Published tile index generation ${generation}`)
   try {
      prune_generations(generation)
   } catch (error) {
      console.warn(`Unable to prune old tile index generations: ${error.message}`)
   }
} catch (error) {
   if (!published && generation_directory && fs.existsSync(generation_directory)) {
      fs.rmSync(generation_directory, {recursive: true, force: true})
   }
   console.error(`Tile index refresh failed: ${error.message}`)
   process.exitCode = 1
} finally {
   if (lock_handle !== undefined) {
      fs.closeSync(lock_handle)
      fs.rmSync(lock_file, {force: true})
   }
}
