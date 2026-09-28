import fs from 'node:fs'
import path from 'node:path'

import {
   TILE_SOURCE_RELEASE_MANIFEST,
   TILE_SOURCE_RELEASE_SCHEMA,
   read_source_tile,
   tile_source_path,
} from '../sdk/FractoTileSource.js'

const ROOT_DIRECTORY = path.resolve(import.meta.dirname, '..')
const ENV_FILE = path.join(ROOT_DIRECTORY, '.env')

const create_release_manifest = async () => {
   if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE)

   const source_directory = process.env.FRACTO_TILE_SOURCE_DIR?.trim()
   const source_generation = process.env.FRACTO_TILE_SOURCE_GENERATION?.trim()
   if (!source_directory || !path.isAbsolute(source_directory)) {
      throw new Error('Set FRACTO_TILE_SOURCE_DIR to the absolute staging directory')
   }
   if (!source_generation || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(source_generation)) {
      throw new Error('Set FRACTO_TILE_SOURCE_GENERATION to a stable identifier (1-128 letters, digits, dot, underscore, or hyphen)')
   }
   if (process.env.FRACTO_TILE_SOURCE_MODE &&
      process.env.FRACTO_TILE_SOURCE_MODE !== 'local') {
      throw new Error('FRACTO_TILE_SOURCE_MODE must be unset or local')
   }
   process.env.FRACTO_TILE_SOURCE_MODE = 'local'
   process.env.FRACTO_TILE_SOURCE_DIR = source_directory
   process.env.FRACTO_TILE_SOURCE_GENERATION = source_generation

   const {TILE_SOURCE_DIRECTORY} = await import('../sdk/FractoTilePaths.js')
   const {validate_tile_index_cache} = await import('../sdk/FractoTileIndexCache.js')

   let source_stats
   try {
      fs.accessSync(TILE_SOURCE_DIRECTORY, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK)
      source_stats = fs.statSync(TILE_SOURCE_DIRECTORY)
   } catch {
      throw new Error('Tile source staging directory must be readable, writable, and searchable')
   }
   if (!source_stats.isDirectory()) {
      throw new Error('FRACTO_TILE_SOURCE_DIR must point to a directory')
   }
   if (fs.existsSync(path.join(source_directory, TILE_SOURCE_RELEASE_MANIFEST))) {
      throw new Error(
         `${TILE_SOURCE_RELEASE_MANIFEST} already exists; do not replace a published release manifest`,
      )
   }

   const index = validate_tile_index_cache()
   const representative_path = tile_source_path(
      source_directory,
      index.representative_short_code,
   )
   try {
      fs.accessSync(representative_path, fs.constants.R_OK)
   } catch {
      throw new Error(
         `The indexed representative tile ${index.representative_short_code} is missing or unreadable`,
      )
   }
   const representative_tile = read_source_tile(
      source_directory,
      index.representative_short_code,
   )
   if (!Array.isArray(representative_tile) || representative_tile.length !== 256 ||
      !Array.isArray(representative_tile[0]) || representative_tile[0].length !== 256 ||
      !Array.isArray(representative_tile[0][0]) || representative_tile[0][0].length !== 2) {
      throw new Error(
         `The indexed representative tile ${index.representative_short_code} has an invalid tile-data shape`,
      )
   }

   const manifest = {
      schema_version: TILE_SOURCE_RELEASE_SCHEMA,
      source_generation,
      index_fingerprint: index.metadata.fingerprint,
      index_tile_count: index.metadata.tile_count,
      tile_validation: {
         method: 'representative-tile-shape-v1',
         short_code: index.representative_short_code,
      },
      created_at: new Date().toISOString(),
   }
   const manifest_path = path.join(source_directory, TILE_SOURCE_RELEASE_MANIFEST)
   const temporary_path = `${manifest_path}.tmp-${process.pid}`
   try {
      fs.writeFileSync(temporary_path, `${JSON.stringify(manifest, null, 2)}\n`, {flag: 'wx'})
      fs.renameSync(temporary_path, manifest_path)
   } catch (error) {
      fs.rmSync(temporary_path, {force: true})
      throw new Error(`Unable to publish tile source release manifest: ${error.message}`)
   }

   return manifest
}

create_release_manifest().then(manifest => {
   console.log(
      `Created ${TILE_SOURCE_RELEASE_MANIFEST} for source generation ${manifest.source_generation} ` +
      `and index fingerprint ${manifest.index_fingerprint}; representative tile ` +
      `${manifest.tile_validation.short_code} decoded successfully.`,
   )
}).catch(error => {
   console.error(`Tile source release preparation failed: ${error.message}`)
   process.exitCode = 1
})
