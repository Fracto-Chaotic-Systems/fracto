import FractoIndexedTiles from "./FractoIndexedTiles.js";
import FractoUtil from "./FractoUtil.js";

let all_indexed_tiles = []
let all_blank_tiles = []
let all_interior_tiles = []
let all_needs_update = []
let classification_loading = null

const count_tiles = level_sets => level_sets.reduce((total, level_set) => {
   return total + level_set.size
}, 0)

const collect_local_indexed_tiles = () => {
   const result = []
   for (let level = 0; level < 30; level++) result[level] = new Set()
   for (let level = 2; level < 30; level++) {
      const set_level = FractoIndexedTiles.get_set_level('indexed', level)
      set_level?.columns.forEach(column => {
         column.tiles.forEach(tile => result[level].add(tile.short_code))
      })
   }
   return result
}

const load_classifications = async () => {
   if (classification_loading) return classification_loading
   classification_loading = (async () => {
      const load = tile_set_name => new Promise(resolve =>
         collect_category_tiles(tile_set_name, resolve))
      const [blank, interior, needs_update] = await Promise.all([
         load('blank'), load('interior'), load('needs_update'),
      ])
      all_blank_tiles = blank
      all_interior_tiles = interior
      all_needs_update = needs_update
      console.warn('coverage manifests are remote and may not match the local compiled tile index; proceeding')
      const stats = {
         indexed: count_tiles(all_indexed_tiles),
         blank: count_tiles(all_blank_tiles),
         interior: count_tiles(all_interior_tiles),
         needs_update: count_tiles(all_needs_update),
      }
      console.log(stats)
      return stats
   })()
   return classification_loading
}

export const preload_coverage_classifications = () => load_classifications()

export const initialize_coverage = (cb) => {
   all_indexed_tiles = collect_local_indexed_tiles()
   console.log('indexed coverage derived from local compiled tile index', count_tiles(all_indexed_tiles))
   if (cb) cb({indexed: count_tiles(all_indexed_tiles), deferred: true})
}

export const collect_category_tiles = (tile_set_name, cb) => {
   const result = []
   for (let level = 0; level < 30; level++) {
      result[level] = new Set()
   }
   FractoIndexedTiles.load_short_codes(tile_set_name, short_codes => {
      short_codes.forEach(sc => {
         const short_code = sc
            .replace('.gz', '')
         const level = short_code.length
         if (!result[level]) {
            // console.log('bad level/result', level, short_code, result[level])
            return;
         }
         result[level].add(short_code)
      })
      cb(result)
   })
}

const MAX_TILES = 100000

export const detect_coverage = async (focal_point, scope) => {
   await load_classifications()
   const tiles_in_scope = [];
   for (let level = 2; level < 30; level++) {
      const level_tiles = FractoIndexedTiles.tiles_in_scope(level, focal_point, scope);
      if (level_tiles.length < MAX_TILES) {
         tiles_in_scope.push({
            level: level,
            tiles: level_tiles
         });
      }
      else {
         break;
      }
   }

   const filtered_tiles_in_scope = tiles_in_scope //.filter(scoped => scoped.tiles.length > 1);
   console.log('filtered_tiles_in_scope', filtered_tiles_in_scope.length)

   let coverage_data = filtered_tiles_in_scope.map(scoped => {
      return {
         level: scoped.level,
         tile_count: scoped.tiles.length,
         tiles: scoped.tiles,
      };
   });
   if (filtered_tiles_in_scope.length) {
      coverage_data.push({
         level: filtered_tiles_in_scope[filtered_tiles_in_scope.length - 1].level + 1,
         tile_count: 0,
         tiles: [],
      });
   }
// Use Sets for faster lookups and to avoid duplicates
   const can_do = new Set();
   const blank_tiles = new Set();
   const interior_tiles = new Set();
   const needs_update = new Set();
   console.log('processing all scoped tiles');
   coverage_data.forEach(cd => {
      console.log(`level: ${cd.level}, tiles: ${cd.tiles.length}`)
      cd.tiles.forEach(tile => {
         const short_code = tile.short_code;
         const level = cd.level
         const in_update = all_needs_update[level].has(short_code);
         if (in_update) {
            needs_update.add(short_code);
         }
         const new_level = short_code.length + 1;
         for (let i = 0; i < 4; i++) {
            const sc = `${short_code}${i}`;
            const in_blank = all_blank_tiles[new_level]?.has(sc);
            if (in_blank) {
               blank_tiles.add(sc);
            } else {
               const in_indexed = all_indexed_tiles[new_level]?.has(sc);
               const in_interior = all_interior_tiles[new_level]?.has(sc);
               if (in_interior && !in_indexed) {
                  interior_tiles.add(sc);
               } else {
                  if (!in_indexed) {
                     can_do.add(sc);
                  }
               }
            }
         }
      });
   })
   console.log('mapping coverage data');
   coverage_data.forEach(data => {
      const filtered_by_level = Array.from(can_do)
         .filter(cd => cd.length === data.level)
         .map(short_code => ({
            short_code,
            bounds: FractoUtil.bounds_from_short_code(short_code)
         }));
      const blanks_by_level = Array.from(blank_tiles)
         .filter(short_code => short_code.length === data.level);
      const interiors_by_level = Array.from(interior_tiles)
         .filter(short_code => short_code.length === data.level);
      const needs_update_by_level = Array.from(needs_update)
         .filter(short_code => short_code.length === data.level);
      const blanks_with_bounds = blanks_by_level.map(short_code => ({
         short_code,
         bounds: FractoUtil.bounds_from_short_code(short_code)
      }));
      const interiors_with_bounds = interiors_by_level.map(short_code => ({
         short_code,
         bounds: FractoUtil.bounds_from_short_code(short_code)
      }));
      const needs_update_with_bounds = needs_update_by_level.map(short_code => ({
         short_code,
         bounds: FractoUtil.bounds_from_short_code(short_code)
      }));
      data.filtered_by_level = filtered_by_level;
      data.blanks_by_level = blanks_with_bounds;
      data.interiors_with_bounds = interiors_with_bounds
      data.needs_update_with_bounds = needs_update_with_bounds
      data.tile_count = data.tiles.length
   });
   return coverage_data
}
