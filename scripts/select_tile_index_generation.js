import fs from 'node:fs'
import path from 'node:path'

import {
   TILE_INDEX_CURRENT_FILE,
   TILE_INDEX_ROOT,
   read_current_tile_index_generation,
   tile_index_generation_directory,
} from '../sdk/FractoTilePaths.js'

export const select_tile_index_generation = generation => {
   const generation_directory = tile_index_generation_directory(generation)
   if (!fs.existsSync(path.join(generation_directory, 'COMPLETE'))) {
      throw new Error(`Tile index generation ${generation} is missing or incomplete`)
   }

   const lock_path = path.join(TILE_INDEX_ROOT, 'REFRESH.lock')
   let lock_handle
   try {
      lock_handle = fs.openSync(lock_path, 'wx')
   } catch (error) {
      throw new Error(error.code === 'EEXIST'
         ? 'A tile-index refresh or generation switch is in progress; wait for it to finish before switching generations'
         : `Unable to lock tile index selection: ${error.message}`)
   }
   try {
      fs.writeFileSync(lock_handle, `${JSON.stringify({
         hostname: process.env.HOSTNAME || 'local',
         pid: process.pid,
         operation: 'select-generation',
      })}\n`)
   } catch (error) {
      fs.closeSync(lock_handle)
      fs.rmSync(lock_path, {force: true})
      throw new Error(`Unable to write tile index selection lock: ${error.message}`)
   }

   try {
      const previous_generation = read_current_tile_index_generation()
      if (previous_generation === generation) return previous_generation

      const temporary_path = `${TILE_INDEX_CURRENT_FILE}.tmp-${process.pid}`
      try {
         fs.writeFileSync(temporary_path, `${generation}\n`, {flag: 'wx'})
         fs.renameSync(temporary_path, TILE_INDEX_CURRENT_FILE)
      } catch (error) {
         fs.rmSync(temporary_path, {force: true})
         throw new Error(`Unable to select tile index generation ${generation}: ${error.message}`)
      }
      return previous_generation
   } finally {
      fs.closeSync(lock_handle)
      fs.rmSync(lock_path, {force: true})
   }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
   try {
      const generation = process.argv[2]
      if (!generation) throw new Error('Usage: node scripts/select_tile_index_generation.js <complete-generation>')
      const previous_generation = select_tile_index_generation(generation)
      console.log(`Selected tile index generation ${generation} (previous: ${previous_generation || 'none'}).`)
   } catch (error) {
      console.error(`Tile index selection failed: ${error.message}`)
      process.exitCode = 1
   }
}
