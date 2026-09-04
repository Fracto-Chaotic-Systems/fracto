import fs from 'node:fs'
import path from 'node:path'
import v8 from 'node:v8'
import {tile_index_paths} from '../sdk/FractoTilePaths.js'
import FractoIndexedTiles from '../sdk/FractoIndexedTiles.js'

const {base} = tile_index_paths({require_complete: false})
const coverage_directory = path.join(base, 'coverage')
fs.mkdirSync(coverage_directory, {recursive: true})

const load_category = category => new Promise((resolve, reject) => {
   FractoIndexedTiles.load_short_codes(category, short_codes => {
      if (!short_codes.length) {
         reject(new Error(`Remote ${category} classification manifest was empty`))
         return
      }
      const levels = Array.from({length: 30}, () => new Set())
      short_codes.forEach(short_code => {
         const normalized = short_code.replace('.gz', '')
         const level = normalized.length
         if (levels[level]) levels[level].add(normalized)
      })
      resolve(levels.map(level => [...level]))
   })
})

const run = async () => {
   const categories = ['blank', 'interior', 'needs_update']
   const metadata = {created_at: new Date().toISOString(), categories: {}}
   for (const category of categories) {
      console.log(`Building local ${category} coverage cache...`)
      const levels = await load_category(category)
      const filepath = path.join(coverage_directory, `${category}.bin`)
      fs.writeFileSync(filepath, v8.serialize(levels))
      metadata.categories[category] = levels.reduce((total, level) => total + level.length, 0)
      console.log(`Cached ${metadata.categories[category]} ${category} tiles`)
   }
   fs.writeFileSync(path.join(coverage_directory, 'metadata.json'), JSON.stringify(metadata, null, 2))
}

run().catch(error => {
   console.error(`Coverage cache build failed: ${error.message}`)
   process.exitCode = 1
})
