import fs from 'node:fs'
import path from 'node:path'
import {deserialize} from 'node:v8'

import {tile_index_paths} from './FractoTilePaths.js'

const parse_packet_level = filename => {
   const match = filename.match(/_level_(\d+)(?:_|\.json$)/)
   if (!match) throw new Error(`Cannot determine tile level from index packet ${filename}`)
   return Number(match[1])
}

const read_source_codes = (source_directory, level) => {
   const directory_path = path.join(source_directory, `L${String(level).padStart(2, '0')}`)
   const codes = new Set()
   const directory = fs.opendirSync(directory_path)
   try {
      let entry = directory.readSync()
      while (entry) {
         if (entry.isFile() && entry.name.endsWith('.gz')) {
            const short_code = entry.name.slice(0, -3)
            if (!/^\d+$/.test(short_code) || short_code.length !== level) {
               throw new Error(`Invalid tile filename in L${String(level).padStart(2, '0')}: ${entry.name}`)
            }
            codes.add(short_code)
         }
         entry = directory.readSync()
      }
   } finally {
      directory.closeSync()
   }
   return codes
}

/** Verifies exact equality between indexed short codes and local tile filenames. */
export const verify_tile_source_index = ({
   source_directory,
   index_metadata,
}) => {
   const {source, cache} = tile_index_paths()
   const packet_manifest_path = path.join(source, 'packet_manifest.json')
   const packet_manifest = JSON.parse(fs.readFileSync(packet_manifest_path, 'utf8'))
   const compiled_directory = path.join(cache, index_metadata.fingerprint)
   const packets_by_level = new Map()
   packet_manifest.packet_files.forEach((filename, packet_index) => {
      const level = parse_packet_level(filename)
      const packets = packets_by_level.get(level) || []
      packets.push({filename, packet_index})
      packets_by_level.set(level, packets)
   })

   const source_levels = fs.readdirSync(source_directory, {withFileTypes: true})
      .filter(entry => entry.isDirectory() && /^L\d{2}$/.test(entry.name))
      .map(entry => Number(entry.name.slice(1)))
   const levels = [...new Set([...source_levels, ...packets_by_level.keys()])].sort((a, b) => a - b)
   if (!levels.length) throw new Error('No local tile levels or compiled index packets were found')

   let verified_tile_count = 0
   const counts_by_level = {}
   for (const level of levels) {
      const level_directory = `L${String(level).padStart(2, '0')}`
      const source_codes = source_levels.includes(level)
         ? read_source_codes(source_directory, level)
         : new Set()
      let indexed_count = 0
      for (const {filename, packet_index} of packets_by_level.get(level) || []) {
         const cache_file = path.join(
            compiled_directory,
            `${packet_index.toString().padStart(4, '0')}.bin`,
         )
         let packet
         try {
            packet = deserialize(fs.readFileSync(cache_file))
         } catch {
            throw new Error(`Unable to read compiled tile-index packet ${packet_index + 1} (${filename})`)
         }
         if (packet.level !== level || !Array.isArray(packet.columns)) {
            throw new Error(`Compiled tile-index packet ${packet_index + 1} has an invalid level or structure`)
         }
         for (const column of packet.columns) {
            if (!Array.isArray(column.tiles)) {
               throw new Error(`Compiled tile-index packet ${packet_index + 1} has an invalid column`)
            }
            for (const tile of column.tiles) {
               const short_code = tile.short_code
               if (typeof short_code !== 'string' || short_code.length !== level || !/^\d+$/.test(short_code)) {
                  throw new Error(`Compiled tile-index packet ${packet_index + 1} contains an invalid short code`)
               }
               if (!source_codes.delete(short_code)) {
                  throw new Error(
                     `Compiled index tile ${short_code} is absent from the local corpus or appears more than once`,
                  )
               }
               indexed_count++
            }
         }
      }
      if (source_codes.size) {
         const unindexed_short_code = source_codes.values().next().value
         throw new Error(`Local corpus tile ${unindexed_short_code} in ${level_directory} is not present in the compiled index`)
      }
      if (indexed_count) counts_by_level[level_directory] = indexed_count
      verified_tile_count += indexed_count
   }

   if (verified_tile_count !== index_metadata.tile_count) {
      throw new Error(
         `Verified source/index tile count ${verified_tile_count} does not match compiled index count ${index_metadata.tile_count}`,
      )
   }
   return {verified_tile_count, counts_by_level}
}
