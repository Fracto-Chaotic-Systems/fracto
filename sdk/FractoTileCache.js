import network from "../config/network.json" with {type: "json"};
import zlib from "zlib";
import path from "path";
import fs from "fs";
import https from "https";
import {ROOT_DIR} from "../constants.js";

const SEPARATOR = path.sep;
const TILES_DIR = `${ROOT_DIR}${SEPARATOR}tiles`;
console.log('TILES_DIR is', TILES_DIR);
if (!fs.existsSync(TILES_DIR)) {
   fs.mkdirSync(TILES_DIR)
}
let CACHED_TILES = {}

const CACHE_TIMEOUT = 2 * 1000 * 60;
const QUICK_CACHE_TIMEOUT = 1000 * 60;
const MIN_CACHE = 750
const MAX_CACHE = 1250

const dir_from_short_code = (short_code) => {
   const pieces = short_code.match(/.{1,4}/g);
   const last_piece = pieces[pieces.length - 1];
   if (last_piece.length < 4) {
      pieces.pop()
   }
   const joined_pieces = pieces.join(SEPARATOR)
   const level_dir = joined_pieces.length
      ? `${TILES_DIR}${SEPARATOR}${joined_pieces}`
      : TILES_DIR
   if (!fs.existsSync(level_dir)) {
      fs.mkdirSync(level_dir, {recursive: true})
   }
   // console.log(`${short_code}: ${level_dir}`)
   return level_dir;
}

const https_get = (remote_filepath, localSavePath) => {
   return new Promise((resolve, reject) => {
      const fileStream = fs.createWriteStream(localSavePath);
      const remoteGzUrl = `${network["fracto-prod"]}/${remote_filepath}`
      https.get(remoteGzUrl, (response) => {
         response.pipe(fileStream);
         fileStream.on('finish', () => {
            fileStream.close();
            resolve()
         });
         fileStream.on('error', (err) => {
            console.error('Error writing to file:', err);
            resolve()
         });
      }).on('error', (err) => {
         console.error('Error downloading file:', err);
         resolve()
      });
   })
}

const store_tile = async (short_code, coded_dir) => {
   try {
      const level = short_code.length
      const naught = level < 10 ? '0' : ''
      const level_dirname = `L${naught}${level}`
      const localSavePath = `${coded_dir}${SEPARATOR}${short_code}.gz`
      const remote_filepath = `${level_dirname}/${short_code}.gz`
      await https_get(remote_filepath, localSavePath)
      const gzippedData = fs.readFileSync(localSavePath);
      const decompressedData = zlib.gunzipSync(gzippedData);
      const jsonString = decompressedData.toString('utf8');
      console.log(`fetched: ${short_code}`);
      return JSON.parse(jsonString);
   } catch (e) {
      console.error(`store_tile error ${short_code}`, e.message)
      return false;
   }
}

const load_tile = async (short_code, coded_dir) => {
   try {
      const localSavePath = `${coded_dir}${SEPARATOR}${short_code}.gz`
      if (!fs.existsSync(localSavePath)) {
         return false
      }
      const gzippedData = fs.readFileSync(localSavePath);
      const decompressedData = zlib.gunzipSync(gzippedData);
      const jsonString = decompressedData.toString('utf8');
      console.log(`loaded: ${short_code}`);
      return JSON.parse(jsonString);
   } catch (e) {
      console.error(`load_tile error ${short_code}`, e.message)
      return false;
   }
}

export class FractoTileCache {

   static error_count = 0;

   static get_tile = async (short_code) => {
      if (CACHED_TILES[short_code]) {
         CACHED_TILES[short_code].last_access = Date.now()
         CACHED_TILES[short_code].access_count++
         return CACHED_TILES[short_code].uncompressed;
      }
      if (FractoTileCache.error_count > 100) {
         return null;
      }
      const coded_dir = dir_from_short_code(short_code)
      try {
         let tile = await load_tile(short_code, coded_dir)
         if (tile) {
            CACHED_TILES[short_code] = {
               uncompressed: tile,
               last_access: Date.now(),
               access_count: 1,
            }
            // console.log('loaded tile length', tile.length);
            return tile
         }
         tile = await store_tile(short_code, coded_dir)
         if (tile) {
            CACHED_TILES[short_code] = {
               uncompressed: tile,
               last_access: Date.now(),
               access_count: 1,
            }
            // console.log('fetched tile length', tile.length);
            return tile
         }
      } catch (e) {
         console.error(`get_tile error ${short_code}`, e.message)
         FractoTileCache.error_count++
         return null
      }
   }

   static trim_cache(extra_ms = 0) {
      const short_codes = Object.keys(CACHED_TILES)
      if (short_codes.length < MIN_CACHE) {
         return;
      }
      const timeout = short_codes.length > MAX_CACHE
         ? QUICK_CACHE_TIMEOUT
         : CACHE_TIMEOUT
      let delete_count = 0
      short_codes.forEach((short_code) => {
         if (CACHED_TILES[short_code].last_access < Date.now() - timeout + extra_ms) {
            // console.log(`deleting ${short_code} from cache`)
            delete_count++
            delete CACHED_TILES[short_code]
         }
      })
      if (delete_count > 1) {
         console.log(`trim_cache deleted: ${delete_count} from ${short_codes.length}`)
      }
   }
}

export default FractoTileCache