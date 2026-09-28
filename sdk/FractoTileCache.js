import zlib from "zlib";
import path from "path";
import fs from "fs";
import https from "https";
import {
   TILE_DATA_DIRECTORY,
   TILE_SOURCE_DIRECTORY,
   TILE_SOURCE_GENERATION,
   TILE_SOURCE_MODE,
} from './FractoTilePaths.js'
import {read_source_tile, tile_cache_identity} from './FractoTileSource.js'
import {color_shortcode} from '../utils/ansi_colors.js'

const SEPARATOR = path.sep;
const TILES_DIR = TILE_DATA_DIRECTORY;
console.log('TILES_DIR is', TILES_DIR);
if (TILE_SOURCE_MODE !== 'local' && !fs.existsSync(TILES_DIR)) {
   fs.mkdirSync(TILES_DIR, {recursive: true})
}
let CACHED_TILES = {}
const IN_FLIGHT_DOWNLOADS = new Map()
let REMOTE_TILE_BASE_URL_PROMISE = null
const CACHE_STATS = {
   requests: 0,
   memory_hits: 0,
   disk_hits: 0,
   downloads: 0,
   readonly_downloads: 0,
   local_source_reads: 0,
   local_source_failures: 0,
   last_source_error: null,
   failures: 0,
   coalesced_requests: 0,
   evictions: 0,
   download_bytes: 0,
   download_duration_ms: 0,
   last_download_at: null,
}
const cache_identity = short_code => tile_cache_identity(
   TILE_SOURCE_MODE,
   TILE_SOURCE_GENERATION,
   short_code,
)
const CACHE_TIMEOUT = 2 * 1000 * 60;
const QUICK_CACHE_TIMEOUT = 1000 * 60;
const MIN_CACHE = 750
const MAX_CACHE = 1250
const MIN_FREE_BYTES = Number(process.env.FRACTO_TILE_MIN_FREE_BYTES || 1024 ** 3)
const CACHE_READ_ONLY = process.env.FRACTO_TILE_CACHE_READ_ONLY === 'true'

const remote_tile_url = async remote_filepath => {
   const configured_base_url = process.env.FRACTO_TILE_REMOTE_BASE_URL
   if (typeof configured_base_url === 'string' && configured_base_url.trim()) {
      return `${configured_base_url.trim().replace(/\/$/, '')}/${remote_filepath}`
   }
   if (!REMOTE_TILE_BASE_URL_PROMISE) {
      REMOTE_TILE_BASE_URL_PROMISE = import('../config/network.json', {with: {type: 'json'}})
         .then(({default: network}) => {
            const base_url = network['fracto-prod']
            if (typeof base_url !== 'string' || !base_url.trim()) {
               throw new Error('config/network.json must provide a non-empty fracto-prod URL for remote-cache mode')
            }
            return base_url.replace(/\/$/, '')
         })
   }
   return `${await REMOTE_TILE_BASE_URL_PROMISE}/${remote_filepath}`
}

if (!Number.isFinite(MIN_FREE_BYTES) || MIN_FREE_BYTES < 0) {
   throw new Error('FRACTO_TILE_MIN_FREE_BYTES must be a non-negative number')
}

const assert_cache_capacity = () => {
   const stats = fs.statfsSync(TILES_DIR)
   const free_bytes = stats.bavail * stats.bsize
   if (free_bytes < MIN_FREE_BYTES) {
      throw new Error(
         `Tile cache has ${free_bytes} free bytes; ${MIN_FREE_BYTES} are required`,
      )
   }
}

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
   if (!CACHE_READ_ONLY && !fs.existsSync(level_dir)) {
      fs.mkdirSync(level_dir, {recursive: true})
   }
   // console.log(`${short_code}: ${level_dir}`)
   return level_dir;
}

const https_get = async (remote_filepath, localSavePath) => {
   const remoteGzUrl = await remote_tile_url(remote_filepath)
   return new Promise((resolve, reject) => {
      const temporaryPath = `${localSavePath}.tmp-${process.pid}-${Date.now()}`
      const fileStream = fs.createWriteStream(temporaryPath, {flags: 'wx'});
      https.get(remoteGzUrl, (response) => {
         if (response.statusCode !== 200) {
            response.resume()
            fileStream.destroy()
            fs.rmSync(temporaryPath, {force: true})
            reject(new Error(`Tile download returned HTTP ${response.statusCode}`))
            return
         }
         response.pipe(fileStream);
         fileStream.on('finish', () => {
            fileStream.close();
            try {
               const gzippedData = fs.readFileSync(temporaryPath)
               zlib.gunzipSync(gzippedData)
               fs.renameSync(temporaryPath, localSavePath)
               resolve()
            } catch (error) {
               fs.rmSync(temporaryPath, {force: true})
               reject(error)
            }
         });
         fileStream.on('error', (err) => {
            console.error('Error writing to file:', err);
            fs.rmSync(temporaryPath, {force: true})
            reject(err)
         });
      }).on('error', (err) => {
         console.error('Error downloading file:', err);
         fileStream.destroy()
         fs.rmSync(temporaryPath, {force: true})
         reject(err)
      });
   })
}

const https_load = async remote_filepath => {
   const remoteGzUrl = await remote_tile_url(remote_filepath)
   return new Promise((resolve, reject) => {
      https.get(remoteGzUrl, (response) => {
         if (response.statusCode !== 200) {
            response.resume()
            reject(new Error(`Tile download returned HTTP ${response.statusCode}`))
            return
         }
         const chunks = []
         response.on('data', chunk => chunks.push(chunk))
         response.on('end', () => resolve(Buffer.concat(chunks)))
         response.on('error', reject)
      }).on('error', reject)
   })
}

const store_tile = async (short_code, coded_dir) => {
   try {
      const download_started = Date.now()
      const level = short_code.length
      const naught = level < 10 ? '0' : ''
      const level_dirname = `L${naught}${level}`
      const localSavePath = `${coded_dir}${SEPARATOR}${short_code}.gz`
      const remote_filepath = `${level_dirname}/${short_code}.gz`
      let gzippedData
      if (CACHE_READ_ONLY) {
         CACHE_STATS.readonly_downloads++
         gzippedData = await https_load(remote_filepath)
      } else {
         assert_cache_capacity()
         await https_get(remote_filepath, localSavePath)
         gzippedData = fs.readFileSync(localSavePath)
      }
      const decompressedData = zlib.gunzipSync(gzippedData);
      const jsonString = decompressedData.toString('utf8');
      CACHE_STATS.downloads++
      CACHE_STATS.download_bytes += gzippedData.length
      CACHE_STATS.download_duration_ms += Date.now() - download_started
      CACHE_STATS.last_download_at = new Date().toISOString()
      console.log(`fetched: ${color_shortcode(short_code)}`);
      return JSON.parse(jsonString);
   } catch (e) {
      CACHE_STATS.failures++
      console.error(`store_tile error ${color_shortcode(short_code)}`, e.message)
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
      CACHE_STATS.disk_hits++
      console.log(`loaded: ${color_shortcode(short_code)}`);
      return JSON.parse(jsonString);
   } catch (e) {
      CACHE_STATS.failures++
      console.error(`load_tile error ${color_shortcode(short_code)}`, e.message)
      return false;
   }
}

export class FractoTileCache {

   static error_count = 0;

   static get_tile = async (short_code) => {
      CACHE_STATS.requests++
      const identity = cache_identity(short_code)
      if (CACHED_TILES[identity]) {
         CACHE_STATS.memory_hits++
         CACHED_TILES[identity].last_access = Date.now()
         CACHED_TILES[identity].access_count++
         return CACHED_TILES[identity].uncompressed;
      }
      if (TILE_SOURCE_MODE !== 'local' && FractoTileCache.error_count > 100) {
         return null;
      }
      if (IN_FLIGHT_DOWNLOADS.has(identity)) {
         CACHE_STATS.coalesced_requests++
         return IN_FLIGHT_DOWNLOADS.get(identity)
      }
      const load_or_download = (async () => {
         if (TILE_SOURCE_MODE === 'local') {
            try {
               const tile = read_source_tile(TILE_SOURCE_DIRECTORY, short_code)
               CACHED_TILES[identity] = {
                  uncompressed: tile,
                  last_access: Date.now(),
                  access_count: 1,
               }
               CACHE_STATS.local_source_reads++
               return tile
            } catch (e) {
               CACHE_STATS.failures++
               CACHE_STATS.local_source_failures++
               CACHE_STATS.last_source_error = {
                  code: e.code || 'TILE_SOURCE_READ_FAILED',
                  kind: e.kind || 'read_failed',
                  short_code,
                  timestamp: new Date().toISOString(),
               }
               console.error(`local source tile read failed ${color_shortcode(short_code)} (${CACHE_STATS.last_source_error.code})`)
               throw e
            }
         }
         const coded_dir = dir_from_short_code(short_code)
         try {
            let tile = await load_tile(short_code, coded_dir)
            if (tile) {
               CACHED_TILES[identity] = {
                  uncompressed: tile,
                  last_access: Date.now(),
                  access_count: 1,
               }
               // console.log('loaded tile length', tile.length);
               return tile
            }
            tile = await store_tile(short_code, coded_dir)
            if (tile) {
               CACHED_TILES[identity] = {
                  uncompressed: tile,
                  last_access: Date.now(),
                  access_count: 1,
               }
               // console.log('fetched tile length', tile.length);
               return tile
            }
         } catch (e) {
            CACHE_STATS.failures++
            console.error(`get_tile error ${color_shortcode(short_code)}`, e.message)
            FractoTileCache.error_count++
            return null
         }
      })()
      IN_FLIGHT_DOWNLOADS.set(identity, load_or_download)
      try {
         return await load_or_download
      } finally {
         IN_FLIGHT_DOWNLOADS.delete(identity)
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
            CACHE_STATS.evictions++
            delete CACHED_TILES[short_code]
         }
      })
      if (delete_count > 1) {
         console.log(`trim_cache deleted: ${delete_count} from ${short_codes.length}`)
      }
   }

   static get_stats = () => ({
      ...CACHE_STATS,
      source_mode: TILE_SOURCE_MODE,
      source_generation: TILE_SOURCE_MODE === 'local' ? TILE_SOURCE_GENERATION : null,
      in_memory: Object.keys(CACHED_TILES).length,
      in_flight: IN_FLIGHT_DOWNLOADS.size,
      error_count: FractoTileCache.error_count,
      read_only: TILE_SOURCE_MODE === 'local' || CACHE_READ_ONLY,
      limits: {min: MIN_CACHE, max: MAX_CACHE},
   })
}

export default FractoTileCache
