import fs from 'node:fs'
import path from 'node:path'
import fetch from 'node-fetch';
import csv from 'csv-parser';
import {TILE_SOURCE_DIRECTORY, TILE_SOURCE_MODE} from './FractoTilePaths.js'

let REMOTE_TILE_BASE_URL_PROMISE = null

const get_remote_tile_base_url = () => {
   const configured_base_url = process.env.FRACTO_TILE_REMOTE_BASE_URL
   if (typeof configured_base_url === 'string' && configured_base_url.trim()) {
      return Promise.resolve(configured_base_url.trim().replace(/\/$/, ''))
   }
   if (!REMOTE_TILE_BASE_URL_PROMISE) {
      REMOTE_TILE_BASE_URL_PROMISE = import('../config/network.json', {with: {type: 'json'}})
         .then(({default: network}) => {
            const base_url = network['fracto-prod']
            if (typeof base_url !== 'string' || !base_url.trim()) {
               throw new Error('config/network.json must provide a non-empty fracto-prod URL for remote index listings')
            }
            return base_url.replace(/\/$/, '')
         })
   }
   return REMOTE_TILE_BASE_URL_PROMISE
}

export const TILE_SET_INDEXED = 'indexed'
export const TILE_SET_READY = 'ready'
export const TILE_SET_INLAND = 'inland'
export const TILE_SET_NEW = 'new'
export const TILE_SET_EMPTY = 'empty'
export const TILE_SET_UPDATED = 'updated'
const ALL_TILE_SETS = [
   TILE_SET_INDEXED,
   TILE_SET_READY,
   TILE_SET_INLAND,
   TILE_SET_NEW,
   TILE_SET_EMPTY,
   TILE_SET_UPDATED,
]

async function streamCsvFromUrl(url, cb) {
   try {
      // 1. Fetch the remote resource and get a readable stream
      const response = await fetch(url);

      if (!response.ok) {
         throw new Error(`HTTP error! status: ${response.status}`);
      }
      const results = []

      // 2. Pipe the response body stream to the csv-parser transform stream
      response.body // This is a Node.js ReadableStream
         .pipe(csv()) // Transform stream converts CSV chunks to JS objects
         .on('data', (data) => {
            // 3. Process each row of data as it comes in
            results.push(data.short_code);

            if (results.length % 1000000 === 0) {
               console.log(`[${results.length}] from csv stream`);
            }
         })
         .on('end', () => {
            // 4. Handle the end of the stream
            console.log('Finished reading CSV file.');
            console.log(`Total rows processed: ${results.length}`);
            cb(results);
            // console.log('All results:', results);
         })
         .on('error', (error) => {
            // 5. Handle any errors during streaming or parsing
            console.error('Error during CSV processing:', error);
         });
   } catch (error) {
      console.error('Fetch operation failed:', error);
      cb([])
   }
}

function streamCsvFromFile(filepath, relative_path, cb) {
   const results = []
   const file_stream = fs.createReadStream(filepath)
   const csv_stream = file_stream.pipe(csv())
   let failed = false
   csv_stream.on('data', data => {
      if (typeof data.short_code === 'string' && data.short_code.trim()) {
         results.push(data.short_code.trim())
      }
      if (results.length && results.length % 1000000 === 0) {
         console.log(`[${results.length}] from local ${relative_path}`)
      }
   })
   csv_stream.once('end', () => {
      console.log(`Read ${results.length} short codes from local ${relative_path}`)
      cb(results)
   })
   const fail = error => {
      if (failed) return
      failed = true
      console.error(`Unable to read local tile listing ${relative_path}: ${error.message}`)
      process.exitCode = 1
      file_stream.destroy()
      csv_stream.destroy()
   }
   file_stream.once('error', fail)
   csv_stream.once('error', fail)
}

export class FractoIndexedTiles {

   static tile_set = null;
   static tile_sets_loaded = [];
   static init_tile_sets = () => {
      if (FractoIndexedTiles.tile_set !== null) {
         return;
      }
      FractoIndexedTiles.tile_set = {}
      ALL_TILE_SETS.forEach(set_name => {
         FractoIndexedTiles.tile_set[set_name] = []
         for (let level = 2; level < 35; level++) {
            FractoIndexedTiles.tile_set[set_name].push({
               level: level,
               tile_size: Math.pow(2, 2 - level),
               columns: []
            })
         }
      })
      // console.log('FractoIndexedTiles.tile_set', FractoIndexedTiles.tile_set)
   }

   static tile_set_is_loaded = (set_name) => {
      console.log("FractoIndexedTiles.tile_sets_loaded", FractoIndexedTiles.tile_sets_loaded)
      return FractoIndexedTiles.tile_sets_loaded.includes(set_name);
   }

   static get_set_level = (set_name, level) => {
      if (FractoIndexedTiles.tile_set === null) {
         FractoIndexedTiles.init_tile_sets();
      }
      // console.log(`set_name: ${set_name}, level: ${level}`)
      return FractoIndexedTiles.tile_set[set_name]
         .find(bin => bin.level === level)
   }

   static integrate_tile_packet = (set_name, packet_data) => {
      const level = packet_data.level
      if (!FractoIndexedTiles.tile_sets_loaded.includes(set_name)) {
         FractoIndexedTiles.tile_sets_loaded.push(set_name)
      }
      let set_level = FractoIndexedTiles.get_set_level(set_name, level)
      // console.log('integrate_tile_packet', level, set_name, packet_data.columns, set_level.columns)
      if (!set_level) {
         console.log(`problem with ${set_name}:${level}`)
         return;
      }
      if (packet_data.columns.length) {
         packet_data.columns.forEach(column => set_level.columns.push(column))
      }
   }

   static load_short_codes = (tile_set_name, cb) => {
      if (typeof tile_set_name !== 'string' || !/^[a-z0-9_-]+$/i.test(tile_set_name)) {
         throw new Error('Tile listing name must contain only letters, digits, underscores, or hyphens')
      }
      if (typeof cb !== 'function') {
         throw new Error('A short-code callback is required')
      }
      if (TILE_SOURCE_MODE === 'local') {
         const relative_path = path.join('manifest', `${tile_set_name}.csv`)
         streamCsvFromFile(
            path.join(TILE_SOURCE_DIRECTORY, relative_path),
            relative_path,
            cb,
         )
         return
      }
      get_remote_tile_base_url().then(base_url => {
         const listing_url = `${base_url}/manifest/${encodeURIComponent(tile_set_name)}.csv`
         streamCsvFromUrl(listing_url, cb)
      }).catch(error => {
         console.error('Unable to resolve remote tile listing URL:', error.message)
         cb([])
      })
   }

   static tiles_in_level = (level, set_name = TILE_SET_INDEXED) => {
      const set_level = FractoIndexedTiles.get_set_level(set_name, level)
      if (!set_level) {
         // console.log(`no bin for level ${level}`)
         return []
      }
      const columns = set_level.columns
      let short_codes = []
      for (let column_index = 0; column_index < columns.length; column_index++) {
         const tiles_in_column = columns[column_index].tiles
         const column_left = columns[column_index].left
         const column_tiles = tiles_in_column
            .map(tile => {
               return {
                  bounds: {
                     left: column_left,
                     right: column_left + set_level.tile_size,
                     bottom: tile.bottom,
                     top: tile.bottom + set_level.tile_size
                  },
                  short_code: tile.short_code
               }
            })
         if (column_tiles.length) {
            column_tiles.forEach(tile => short_codes.push(tile))
         }
      }
      return short_codes.sort((a, b) => {
         return a.bounds.left === b.bounds.left ?
            (a.bounds.top > b.bounds.top ? -1 : 1) :
            (a.bounds.left > b.bounds.left ? 1 : -1)
      })
   }

   static tiles_in_scope = (level, focal_point, scope, aspect_ratio = 1.0, set_name = TILE_SET_INDEXED) => {
      const width_by_two = scope / 2;
      const height_by_two = width_by_two * aspect_ratio;
      const viewport = {
         left: focal_point.x - width_by_two,
         top: focal_point.y + height_by_two,
         right: focal_point.x + width_by_two,
         bottom: focal_point.y - height_by_two,
      }
      const set_level = FractoIndexedTiles.get_set_level(set_name, level)
      if (!set_level) {
         console.log(`no bin for level ${level} of set_name ${set_name}`)
         return []
      }
      if (!set_level.columns.length) {
         // console.log(`no columns for level ${level} of set_name ${set_name}`)
         return []
      }
      // console.log(`tiles_in_scope columns for level ${level}: ${set_level.columns.length}`)
      const columns = set_level.columns
         .filter(column => {
            if (column.left > viewport.right) {
               return false
            }
            if (column.left + set_level.tile_size < viewport.left) {
               return false
            }
            return true;
         })
      let short_codes = []
      for (let column_index = 0; column_index < columns.length; column_index++) {
         const tiles_in_column = columns[column_index].tiles
         const column_left = columns[column_index].left
         const column_tiles = tiles_in_column
            .filter(tile => {
               if (tile.bottom > viewport.top) {
                  return false
               }
               if (tile.bottom + set_level.tile_size < viewport.bottom) {
                  return false
               }
               return true
            })
            .map(tile => {
               return {
                  bounds: {
                     left: column_left,
                     right: column_left + set_level.tile_size,
                     bottom: tile.bottom,
                     top: tile.bottom + set_level.tile_size
                  },
                  short_code: tile.short_code
               }
            })
         short_codes = short_codes.concat(column_tiles)
      }
      return short_codes
   }
}

export default FractoIndexedTiles;
