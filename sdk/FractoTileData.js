import fs from "fs";
import path from "path";
import {ROOT_DIR} from "../constants.js";
import chalk from "chalk";

import FractoIndexedTiles, {TILE_SET_INDEXED} from "./FractoIndexedTiles.js";
import FractoFastCalc from "./FractoFastCalc.js";
import FractoTileCache from "./FractoTileCache.js";

export const FILTER_ALL_TILES = 'filter_all_tiles'
export const FILLING_CANVAS_BUFFER = 'filling_canvas_buffer'

const SEPARATOR = path.sep;
const TILES_DIR = `${ROOT_DIR}${SEPARATOR}tiles`;
const MANIFEST_DIR = `${TILES_DIR}${SEPARATOR}manifest`
const MANIFEST_INDEXED_DIR = `${MANIFEST_DIR}${SEPARATOR}indexed`

if (!fs.existsSync(MANIFEST_DIR)) {
   console.log(chalk.cyan(`creating manifest directory`))
   fs.mkdirSync(MANIFEST_DIR)
}
if (!fs.existsSync(MANIFEST_INDEXED_DIR)) {
   console.log(chalk.cyan(`creating manifest index directory`))
   fs.mkdirSync(MANIFEST_INDEXED_DIR)
}
const MANIFEST_FILEPATH = `${MANIFEST_INDEXED_DIR}${SEPARATOR}packet_manifest.json`

export const get_manifest = (on_update, on_complete) => {
   try {
      console.log(`MANIFEST_FILEPATH is ${MANIFEST_FILEPATH}`)
      const manifest_ascii = fs.readFileSync(MANIFEST_FILEPATH, 'utf-8')
      const tile_manifest = JSON.parse(manifest_ascii);
      const packet_count = tile_manifest.packet_files.length
      const tile_count = tile_manifest.tile_count
      let packet_index = 0
      for (const manifest_file of tile_manifest.packet_files) {
         load_packet(manifest_file)
         if (on_update) {
            on_update({manifest_file, packet_index, packet_count, tile_count});
         }
         packet_index++
      }
      const complete_message = `${TILE_SET_INDEXED} tile set load complete`
      on_complete(complete_message)
   } catch (e) {
      console.log('error in get_manifest()', e);
   }
}

const load_packet = async (manifest_file) => {
   try {
      // console.log(`MANIFEST_INDEXED_DIR is ${MANIFEST_INDEXED_DIR}`)
      const packet_ascii = fs.readFileSync(`${MANIFEST_INDEXED_DIR}/${manifest_file}`, 'utf-8')
      const packet_data = JSON.parse(packet_ascii);
      FractoIndexedTiles.integrate_tile_packet(TILE_SET_INDEXED, packet_data)
   } catch (e) {
      console.log('error in get_manifest()', e);
   }
}

export const get_tiles = (
   width_px,
   focal_point,
   scope,
   aspect_ratio,
   resolution_factor = 2.0) => {

   if (!focal_point) {
      console.log('focal_point undefined', focal_point)
      return []
   }
   const all_tiles = []
   const height_px = width_px * aspect_ratio
   const tiles_on_edge_x = 1 + Math.ceil(width_px / 256);
   const tiles_on_edge_y = 1 + Math.ceil(height_px / 256);
   const max_tiles = 1 + Math.ceil(resolution_factor * tiles_on_edge_x * tiles_on_edge_y)
   const min_level = 4
   const max_level = 30
   for (let level = min_level; level < max_level; level++) {
      const level_tiles = tiles_in_scope(
         level, focal_point, scope, aspect_ratio);
      if (level_tiles.length >= max_tiles && all_tiles.length) {
         break;
      }
      if (level_tiles.length > 10) {
         console.log(`[${level}]: ${level_tiles.length}`)
      }
      if (level_tiles.length) {
         all_tiles.push({
            level: level,
            level_tiles: level_tiles
         })
      } else if (all_tiles.length) {
         break
      }
   }
   // Use a more efficient sort
   return all_tiles.sort((a, b) => a.level - b.level)
}

export const tiles_in_scope = (level, focal_point, scope, aspect_ratio = 1.0, set_name = TILE_SET_INDEXED) => {
   const width_by_two = scope / 2;
   const height_by_two = width_by_two * aspect_ratio;
   const viewport = {
      left: focal_point.x - width_by_two,
      top: focal_point.y + height_by_two,
      right: focal_point.x + width_by_two,
      bottom: focal_point.y - height_by_two,
   }
   const set_level = FractoIndexedTiles.get_set_level(set_name, level)
   if (!set_level || !set_level.columns.length) {
      console.log('!set_level || !set_level.columns.length', set_level, set_level.columns.length)
      return []
   }
   // Filter columns in a single pass
   const columns = []
   // console.log('set_level.columns.length', set_level.columns.length)
   for (let i = 0; i < set_level.columns.length; i++) {
      const col = set_level.columns[i];
      if (col.left > viewport.right) continue;
      if (col.left + set_level.tile_size < viewport.left) continue;
      columns.push(col);
   }
   // console.log('columns', columns)
   const short_codes = []
   const max_y = viewport.top > Math.abs(viewport.bottom)
      ? viewport.top : Math.abs(viewport.bottom)
   for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const col_left = col.left;
      for (let j = 0; j < col.tiles.length; j++) {
         const tile = col.tiles[j];
         if (tile.bottom > max_y) continue;
         if (tile.bottom + set_level.tile_size < viewport.bottom) continue;
         short_codes.push({
            bounds: {
               left: col_left,
               right: col_left + set_level.tile_size,
               bottom: tile.bottom,
               top: tile.bottom + set_level.tile_size
            },
            short_code: tile.short_code
         });
      }
   }
   // console.log('short_codes', short_codes)
   return short_codes
}

export const init_canvas_buffer = (width_px, aspect_ratio) => {
   let height_px = Math.round(width_px * aspect_ratio);
   if (height_px & 1) {
      height_px -= 1
   }
   // Preallocate arrays for better performance
   const buffer = new Array(width_px);
   for (let x = 0; x < width_px; x++) {
      buffer[x] = new Array(height_px);
      for (let y = 0; y < height_px; y++) {
         buffer[x][y] = [0, 4];
      }
   }
   return buffer;
}

export const fill_canvas_buffer = async (
   canvas_buffer,
   width_px,
   focal_point,
   scope,
   aspect_ratio,
   resolution_factor,
   update_callback = null,
   update_status = null) => {

   const all_level_sets = get_tiles(
      width_px,
      focal_point,
      scope,
      aspect_ratio,
      resolution_factor)
   if (update_callback) {
      update_status[FILTER_ALL_TILES] = 1.0
      update_callback(update_status)
   }
   if (!all_level_sets.length) {
      console.log('no level sets for scope', scope)
      return
   }

   const level_data_sets = all_level_sets
      .map(level_set => {
         const tile_width =
            level_set.level_tiles[0].bounds.right
            - level_set.level_tiles[0].bounds.left
         level_set.tile_increment = tile_width / 256
         return level_set
      })
      .sort((a, b) => b.level - a.level)

   await raster_fill(
      canvas_buffer,
      level_data_sets,
      width_px,
      focal_point,
      scope,
      aspect_ratio,
      update_callback,
      update_status
   )
}

export const raster_fill = async (
   canvas_buffer,
   level_data_sets,
   width_px,
   focal_point,
   scope,
   aspect_ratio,
   update_callback = null,
   update_status = null) => {
   if (!canvas_buffer) {
      return;
   }
   const start = performance.now()
   const canvas_increment = scope / width_px
   const height_px = width_px * aspect_ratio
   const horz_scale = new Array(width_px)
   for (let horz_x = 0; horz_x < width_px; horz_x++) {
      horz_scale[horz_x] = focal_point.x + (horz_x - width_px / 2) * canvas_increment
   }
   const vert_scale = new Array(height_px)
   for (let vert_y = 0; vert_y < height_px; vert_y++) {
      vert_scale[vert_y] = Math.abs(focal_point.y - (vert_y - height_px / 2) * canvas_increment)
   }
   let unfound = 0
   const BAD_TILES = {};
   let progress = 0
   const full_progress = height_px * width_px
   const ten_percent = Math.round(full_progress / 10)
   try {
      for (let canvas_x = 0; canvas_x < width_px; canvas_x++) {
         if (update_callback) {
            update_status[FILLING_CANVAS_BUFFER] = (canvas_x + 1) / (width_px + 1)
            update_callback(update_status)
         }
         const x = horz_scale[canvas_x]
         for (let canvas_y = 0; canvas_y < height_px; canvas_y++) {
            const y = vert_scale[canvas_y]
            let found_point = false
            progress++
            if (width_px > 1500 && progress % ten_percent === 0) {
               const percent = Math.round((progress * 10000) / (height_px * width_px)) / 100
               console.log(`${percent}% complete`)
            }
            for (let index = 0; index < level_data_sets.length; index++) {
               const level_data_set = level_data_sets[index]
               for (let t = 0; t < level_data_set.level_tiles.length; t++) {
                  const tile = level_data_set.level_tiles[t];
                  if (tile.bounds.left <= x && tile.bounds.right >= x && tile.bounds.top >= y && tile.bounds.bottom <= y) {
                     if (BAD_TILES[tile.short_code]) {
                        continue;
                     }
                     let tile_data = null
                     try {
                        tile_data = await FractoTileCache.get_tile(tile.short_code)
                        if (!tile_data) {
                           console.log(`bad tile_data: ${tile.short_code}`, tile.bounds)
                           BAD_TILES[tile.short_code] = true
                           break;
                        }
                        let tile_x = Math.round((x - tile.bounds.left) / level_data_set.tile_increment)
                        if (tile_x < 0) {
                           tile_x = 0
                        } else if (tile_x > 255) {
                           tile_x = 255
                        }
                        if (!tile_data[tile_x]) {
                           BAD_TILES[tile.short_code] = true
                           console.log(`bad tile_data[${tile_x}] short_code ${tile.short_code}`)
                           continue;
                        }
                        let tile_y = Math.round((tile.bounds.top - y) / level_data_set.tile_increment)
                        if (tile_y < 0) {
                           tile_y = 0
                        } else if (tile_y > 255) {
                           tile_y = 255
                        }
                        if (!tile_data[tile_x][tile_y]) {
                           BAD_TILES[tile.short_code] = true
                           console.log(`bad tile_data[${tile_x}][${tile_y}] short_code ${tile.short_code}`)
                           continue;
                        }
                        if (!Array.isArray(tile_data[tile_x][tile_y])) {
                           BAD_TILES[tile.short_code] = true
                           console.log(`not an array: tile_data[${tile_x}][${tile_y}] short_code ${tile.short_code}`)
                           continue;
                        }
                        if (tile_data[tile_x][tile_y].length !== 2) {
                           BAD_TILES[tile.short_code] = true
                           console.log(`tile_data[${tile_x}][${tile_y}].length !== 2 short_code ${tile.short_code}`)
                           continue;
                        }
                        canvas_buffer[canvas_x][canvas_y] =
                           [tile_data[tile_x][tile_y][0], tile_data[tile_x][tile_y][1]]
                        found_point = true

                     } catch (e) {
                        console.log(`exception on tile: ${tile.short_code}`, e.message)
                        BAD_TILES[tile.short_code] = true
                        continue;
                     }
                     break;
                  }
               }
               if (found_point) {
                  break
               }
            }
            const out_of_bounds = (x <= -2) || (x > 0.55) || (y >= 1) || (y <= -1)
            if (!found_point && out_of_bounds) {
               unfound++
               // console.log(`unfound, calculating[${canvas_x}][${canvas_y}] (${x}, ${y})`)
               const {pattern, iteration} = FractoFastCalc.calc(x, y)
               canvas_buffer[canvas_x][canvas_y] = [pattern, iteration]
            }
         }
      }
   } catch (error) {
      console.error('raster_fill error', error)
   }
   if (unfound) {
      console.log('unfound', unfound)
   }
   const bad_short_codes = Object.keys(BAD_TILES)
   if (bad_short_codes.length) {
      console.log(`bad TILES`, bad_short_codes)
   }
   const end = performance.now()
   const rounded_time = Math.round((end - start) * 1000) / 1000
   console.log(chalk.yellow(`raster_fill ${width_px}x${height_px} complete in ${rounded_time}ms`))
   setTimeout(() => {
      FractoTileCache.trim_cache()
   }, 1000)
}