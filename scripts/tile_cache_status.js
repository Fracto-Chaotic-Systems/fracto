import fs from 'node:fs'
import path from 'node:path'

import {
   TILE_DATA_DIRECTORY,
   TILE_INDEX_CURRENT_FILE,
   tile_index_paths,
} from '../sdk/FractoTilePaths.js'

const scan_cache = root => {
   const result = {files: 0, tiles: 0, temporary: 0, bytes: 0, oldest: null, newest: null}
   if (!fs.existsSync(root)) return result
   const pending = [root]
   while (pending.length) {
      const directory = pending.pop()
      for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
         const filepath = path.join(directory, entry.name)
         if (entry.isDirectory()) {
            pending.push(filepath)
            continue
         }
         if (!entry.isFile()) continue
         const stats = fs.statSync(filepath)
         result.files++
         result.bytes += stats.size
         result.oldest = result.oldest === null ? stats.mtime.toISOString() : (stats.mtime.toISOString() < result.oldest ? stats.mtime.toISOString() : result.oldest)
         result.newest = result.newest === null ? stats.mtime.toISOString() : (stats.mtime.toISOString() > result.newest ? stats.mtime.toISOString() : result.newest)
         if (entry.name.endsWith('.gz')) result.tiles++
         if (entry.name.includes('.tmp-')) result.temporary++
      }
   }
   return result
}

const current_generation = fs.existsSync(TILE_INDEX_CURRENT_FILE)
   ? fs.readFileSync(TILE_INDEX_CURRENT_FILE, 'utf8').trim() || null
   : null
const index_paths = tile_index_paths({require_complete: false})
const complete = fs.existsSync(path.join(index_paths.base, 'COMPLETE'))
const index_metadata = []
if (fs.existsSync(index_paths.cache)) {
   for (const entry of fs.readdirSync(index_paths.cache, {withFileTypes: true})) {
      if (!entry.isDirectory()) continue
      const metadata_file = path.join(index_paths.cache, entry.name, 'metadata.json')
      if (fs.existsSync(metadata_file)) index_metadata.push(JSON.parse(fs.readFileSync(metadata_file, 'utf8')))
   }
}

const report = {
   tile_cache: scan_cache(TILE_DATA_DIRECTORY),
   filesystem: fs.statfsSync(fs.existsSync(TILE_DATA_DIRECTORY) ? TILE_DATA_DIRECTORY : path.dirname(TILE_DATA_DIRECTORY)),
   index: {
      current_generation,
      base: index_paths.base,
      complete,
      generations: index_metadata,
   },
}
report.filesystem = {
   free_bytes: report.filesystem.bavail * report.filesystem.bsize,
   total_bytes: report.filesystem.blocks * report.filesystem.bsize,
}

if (process.argv.includes('--json')) {
   console.log(JSON.stringify(report, null, 2))
} else {
   console.log(`Tile cache: ${report.tile_cache.tiles} tiles, ${report.tile_cache.bytes} bytes, ${report.tile_cache.temporary} temporary files`)
   console.log(`Filesystem: ${report.filesystem.free_bytes} free of ${report.filesystem.total_bytes} bytes`)
   console.log(`Index: ${current_generation || 'none'} (${complete ? 'complete' : 'incomplete or missing'})`)
   console.log(`Indexed generations with metadata: ${index_metadata.length}`)
}
