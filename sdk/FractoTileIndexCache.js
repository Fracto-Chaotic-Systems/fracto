import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {deserialize, serialize} from 'node:v8'

import {ROOT_DIR} from '../constants.js'
import FractoIndexedTiles, {TILE_SET_INDEXED} from './FractoIndexedTiles.js'

export const TILE_INDEX_CACHE_SCHEMA = 1
export const TILE_INDEX_SOURCE_DIRECTORY = path.join(ROOT_DIR, 'tiles', 'manifest', 'indexed')
export const TILE_INDEX_MANIFEST_FILE = path.join(TILE_INDEX_SOURCE_DIRECTORY, 'packet_manifest.json')
export const TILE_INDEX_CACHE_DIRECTORY = path.join(ROOT_DIR, 'tiles', 'cache', 'indexed')

const read_source_descriptor = () => {
   if (!fs.existsSync(TILE_INDEX_MANIFEST_FILE)) {
      throw new Error(`Missing tile manifest: ${TILE_INDEX_MANIFEST_FILE}`)
   }
   const manifest_text = fs.readFileSync(TILE_INDEX_MANIFEST_FILE, 'utf8')
   const manifest = JSON.parse(manifest_text)
   if (!Array.isArray(manifest.packet_files) || !manifest.packet_files.length) {
      throw new Error('Tile manifest contains no packet files')
   }

   const hash = crypto.createHash('sha256').update(manifest_text)
   for (const packet_file of manifest.packet_files) {
      const packet_path = path.join(TILE_INDEX_SOURCE_DIRECTORY, packet_file)
      const stats = fs.statSync(packet_path)
      hash.update(`${packet_file}\0${stats.size}\0${stats.mtimeMs}\n`)
   }
   return {manifest, fingerprint: hash.digest('hex')}
}

const cache_paths = fingerprint => {
   const directory = path.join(TILE_INDEX_CACHE_DIRECTORY, fingerprint)
   return {directory, metadata_file: path.join(directory, 'metadata.json')}
}

const reset_tile_sets = () => {
   FractoIndexedTiles.tile_set = null
   FractoIndexedTiles.tile_sets_loaded = []
   FractoIndexedTiles.init_tile_sets()
}

export const build_tile_index_cache = (on_progress = null) => {
   const {manifest, fingerprint} = read_source_descriptor()
   const {directory, metadata_file} = cache_paths(fingerprint)
   if (fs.existsSync(metadata_file)) {
      const metadata = JSON.parse(fs.readFileSync(metadata_file, 'utf8'))
      if (metadata.schema === TILE_INDEX_CACHE_SCHEMA &&
         metadata.packet_count === manifest.packet_files.length) {
         return {...metadata, reused: true}
      }
      throw new Error(`Incomplete cache exists at ${directory}; remove it and rebuild`)
   }

   fs.mkdirSync(TILE_INDEX_CACHE_DIRECTORY, {recursive: true})
   const temporary_directory = `${directory}.tmp-${process.pid}`
   fs.mkdirSync(temporary_directory, {recursive: false})
   let binary_bytes = 0

   try {
      manifest.packet_files.forEach((packet_file, packet_index) => {
         const source_path = path.join(TILE_INDEX_SOURCE_DIRECTORY, packet_file)
         const packet_data = JSON.parse(fs.readFileSync(source_path, 'utf8'))
         const binary = serialize(packet_data)
         const cache_file = `${packet_index.toString().padStart(4, '0')}.bin`
         fs.writeFileSync(path.join(temporary_directory, cache_file), binary)
         binary_bytes += binary.length
         on_progress?.({
            level: packet_data.level,
            packet_file,
            packet_index: packet_index + 1,
            packet_count: manifest.packet_files.length,
         })
      })

      const metadata = {
         schema: TILE_INDEX_CACHE_SCHEMA,
         fingerprint,
         created_at: new Date().toISOString(),
         packet_count: manifest.packet_files.length,
         tile_count: manifest.tile_count,
         binary_bytes,
      }
      fs.writeFileSync(
         path.join(temporary_directory, 'metadata.json'),
         JSON.stringify(metadata, null, 2),
      )
      fs.renameSync(temporary_directory, directory)
      return {...metadata, reused: false}
   } catch (error) {
      const resolved_temporary = path.resolve(temporary_directory)
      const resolved_cache = `${path.resolve(TILE_INDEX_CACHE_DIRECTORY)}${path.sep}`
      if (resolved_temporary.startsWith(resolved_cache)) {
         fs.rmSync(resolved_temporary, {recursive: true, force: true})
      }
      throw error
   }
}

export const load_tile_index_cache = (on_progress = null) => {
   const {manifest, fingerprint} = read_source_descriptor()
   const {directory, metadata_file} = cache_paths(fingerprint)
   if (!fs.existsSync(metadata_file)) {
      throw new Error(`Tile index cache is missing or stale. Run npm run tiles:index from ${ROOT_DIR}`)
   }
   const metadata = JSON.parse(fs.readFileSync(metadata_file, 'utf8'))
   if (metadata.schema !== TILE_INDEX_CACHE_SCHEMA) {
      throw new Error(`Unsupported tile index cache schema ${metadata.schema}; run npm run tiles:index`)
   }
   if (metadata.packet_count !== manifest.packet_files.length) {
      throw new Error('Tile index cache packet count does not match the source manifest')
   }

   reset_tile_sets()
   manifest.packet_files.forEach((packet_file, packet_index) => {
      const cache_file = path.join(directory, `${packet_index.toString().padStart(4, '0')}.bin`)
      if (!fs.existsSync(cache_file)) {
         throw new Error(`Tile index cache packet is missing: ${cache_file}`)
      }
      const packet_data = deserialize(fs.readFileSync(cache_file))
      FractoIndexedTiles.integrate_tile_packet(TILE_SET_INDEXED, packet_data)
      on_progress?.({
         level: packet_data.level,
         packet_file,
         packet_index: packet_index + 1,
         packet_count: manifest.packet_files.length,
      })
   })
   return metadata
}