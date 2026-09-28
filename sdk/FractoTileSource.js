import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

export const TILE_SOURCE_RELEASE_MANIFEST = 'fracto-tile-release.json'
export const TILE_SOURCE_RELEASE_SCHEMA = 3

export class TileSourceError extends Error {
   constructor(short_code, kind) {
      super(`Authoritative tile ${short_code} is ${kind.replaceAll('_', ' ')}`)
      this.name = 'TileSourceError'
      this.code = `TILE_SOURCE_${kind.toUpperCase()}`
      this.short_code = short_code
      this.kind = kind
   }
}

/** Validates the immutable source/index binding shipped with a tile release. */
export const validate_tile_source_release = ({
   source_directory,
   source_generation,
   index_metadata,
   representative_short_code,
}) => {
   const manifest_path = path.join(source_directory, TILE_SOURCE_RELEASE_MANIFEST)
   let manifest
   try {
      manifest = JSON.parse(fs.readFileSync(manifest_path, 'utf8'))
   } catch {
      throw new Error(
         `Tile source release manifest is missing or invalid; expected ${TILE_SOURCE_RELEASE_MANIFEST}`,
      )
   }

   if (manifest.schema_version !== 2 &&
      manifest.schema_version !== TILE_SOURCE_RELEASE_SCHEMA) {
      throw new Error(
         `Unsupported tile source release manifest schema ${manifest.schema_version}`,
      )
   }
   if (manifest.source_generation !== source_generation) {
      throw new Error(
         'Tile source release generation does not match FRACTO_TILE_SOURCE_GENERATION',
      )
   }
   if (!/^[a-f0-9]{64}$/.test(manifest.index_fingerprint || '') ||
      manifest.index_fingerprint !== index_metadata?.fingerprint) {
      throw new Error(
         'Tile source release index fingerprint does not match the compiled tile index',
      )
   }
   if (!Number.isInteger(manifest.index_tile_count) ||
      manifest.index_tile_count !== index_metadata?.tile_count) {
      throw new Error(
         'Tile source release tile count does not match the compiled tile index',
      )
   }
   if (manifest.schema_version === 2 &&
      (manifest.tile_inventory?.method !== 'exact-short-code-set-v1' ||
       manifest.tile_inventory?.verified_tile_count !== index_metadata?.tile_count)) {
      throw new Error('Legacy tile source release manifest has an invalid inventory attestation')
   }
   if (manifest.schema_version === TILE_SOURCE_RELEASE_SCHEMA &&
      (manifest.tile_validation?.method !== 'representative-tile-shape-v1' ||
       manifest.tile_validation?.short_code !== representative_short_code)) {
      throw new Error('Tile source release manifest has an invalid representative tile validation')
   }

   return manifest
}

/** Keeps decoded and in-flight tile entries isolated by source generation. */
export const tile_cache_identity = (mode, generation, short_code) => JSON.stringify([
   mode,
   mode === 'local' ? generation : 'default',
   short_code,
])

/** Resolves an authoritative tile file in the source tree's LNN layout. */
export const tile_source_path = (source_directory, short_code) => {
   if (typeof short_code !== 'string' || !/^\d+$/.test(short_code)) {
      throw new Error('Tile short code must contain only digits')
   }
   const level_directory = `L${String(short_code.length).padStart(2, '0')}`
   return path.join(source_directory, level_directory, `${short_code}.gz`)
}

/** Reads and decodes one authoritative gzip-compressed tile file. */
export const read_source_tile = (source_directory, short_code) => {
   const source_path = tile_source_path(source_directory, short_code)
   let compressed_data
   try {
      compressed_data = fs.readFileSync(source_path)
   } catch (error) {
      throw new TileSourceError(short_code, error.code === 'ENOENT' ? 'missing' : 'unreadable')
   }

   let json_data
   try {
      json_data = zlib.gunzipSync(compressed_data).toString('utf8')
   } catch {
      throw new TileSourceError(short_code, 'invalid_gzip')
   }

   try {
      return JSON.parse(json_data)
   } catch {
      throw new TileSourceError(short_code, 'invalid_json')
   }
}
