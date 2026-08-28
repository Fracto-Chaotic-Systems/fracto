import fs from 'node:fs'
import path from 'node:path'

import {ROOT_DIR} from '../constants.js'

export const TILE_DATA_DIRECTORY = path.resolve(
   process.env.FRACTO_TILE_DATA_DIR || path.join(ROOT_DIR, 'tiles'),
)
export const TILE_INDEX_ROOT = path.resolve(
   process.env.FRACTO_TILE_INDEX_DIR || path.join(ROOT_DIR, 'tiles'),
)
export const TILE_INDEX_GENERATIONS_DIRECTORY = path.join(TILE_INDEX_ROOT, 'generations')
export const TILE_INDEX_CURRENT_FILE = path.join(TILE_INDEX_ROOT, 'CURRENT')

const safe_generation_name = generation => {
   if (!/^[a-zA-Z0-9._-]+$/.test(generation)) {
      throw new Error(`Invalid tile index generation: ${generation}`)
   }
   return generation
}

export const tile_index_generation_directory = generation => path.join(
   TILE_INDEX_GENERATIONS_DIRECTORY,
   safe_generation_name(generation),
)

export const read_current_tile_index_generation = () => {
   if (!fs.existsSync(TILE_INDEX_CURRENT_FILE)) return null
   const generation = fs.readFileSync(TILE_INDEX_CURRENT_FILE, 'utf8').trim()
   return generation ? safe_generation_name(generation) : null
}

export const resolve_tile_index_base = ({require_complete = true} = {}) => {
   if (process.env.FRACTO_TILE_INDEX_GENERATION_DIR) {
      return path.resolve(process.env.FRACTO_TILE_INDEX_GENERATION_DIR)
   }
   const generation = read_current_tile_index_generation()
   if (generation) {
      const directory = tile_index_generation_directory(generation)
      if (require_complete && !fs.existsSync(path.join(directory, 'COMPLETE'))) {
         throw new Error(`Tile index generation ${generation} is not complete`)
      }
      return directory
   }
   // Backward-compatible layout used by existing non-container installations.
   return TILE_INDEX_ROOT
}

export const tile_index_paths = options => {
   const base = resolve_tile_index_base(options)
   return {
      base,
      source: path.join(base, 'manifest', 'indexed'),
      cache: path.join(base, 'cache', 'indexed'),
   }
}
