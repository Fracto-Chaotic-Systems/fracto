import network from "../config/network.json" with {type: "json"};
import {decompressSync} from "fflate";
import {Buffer} from "buffer";
import axios from "axios";

let CACHED_TILES = {}

setInterval(() => {
   FractoTileCache.trim_cache()
}, 10000)

const CACHE_TIMEOUT = 2 * 1000 * 60;
const QUICK_CACHE_TIMEOUT = 1000 * 60;
const MIN_CACHE = 750
const MAX_CACHE = 1250

const downloadAndDecompress = async (url) => {
   try {
      const response = await axios.get(url, {
         responseType: 'arraybuffer', // Crucial for handling binary data
      });
      const gzippedBuffer = Buffer.from(response.data);
      const decompressed = decompressSync(gzippedBuffer);
      const ascii = Buffer.from(decompressed, 'ascii');
      return ascii.toString();
   } catch (error) {
      console.error('Error during download or decompression:', error);
      return '[]';
   }
};

export class FractoTileCache {

   static error_count = 0;

   static get_tile_url = async (url) => {
      const result_string = await downloadAndDecompress(url)
      const parsed = JSON.parse(result_string);
      console.log('parsed result length', parsed.length);
      return parsed
   }

   static get_tile = async (short_code) => {
      if (CACHED_TILES[short_code]) {
         CACHED_TILES[short_code].last_access = Date.now()
         CACHED_TILES[short_code].access_count++
         return CACHED_TILES[short_code].uncompressed;
      }
      if (FractoTileCache.error_count > 100) {
         return null;
      }
      const level = short_code.length
      const naught = level < 10 ? '0' : ''
      const url = `${network["fracto-prod"]}/L${naught}${level}/${short_code}.gz`
      try {
         const uncompressed = FractoTileCache.get_tile_url(url)
         if (uncompressed) {
            CACHED_TILES[short_code] = {
               uncompressed: uncompressed,
               last_access: Date.now(),
               access_count: 1,
            }
         } else {
            console.error('failed to decompress');
         }
         return uncompressed
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