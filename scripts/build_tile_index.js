import {build_tile_index_cache} from '../sdk/FractoTileIndexCache.js'

let latest_level = null

try {
   console.log('Building compiled tile index cache...')
   const metadata = build_tile_index_cache(progress => {
      if (progress.level !== latest_level) {
         latest_level = progress.level
         console.log(`Verifying level ${progress.level} (${progress.packet_index}/${progress.packet_count})`)
      }
   })
   const size_gb = (metadata.binary_bytes / (1024 ** 3)).toFixed(2)
   console.log(metadata.reused
      ? `Tile index cache is current: ${metadata.fingerprint}`
      : `Tile index cache built: ${metadata.fingerprint} (${size_gb} GB)`)
   console.log(`Verified tile count: ${metadata.tile_count}`)
   if (metadata.tile_count_difference) {
      console.warn(
         `Source manifest undercount: ${metadata.source_manifest_tile_count} ` +
         `(${metadata.tile_count_difference} missing)`,
      )
   }
} catch (error) {
   console.error(`Tile index build failed: ${error.message}`)
   process.exitCode = 1
}