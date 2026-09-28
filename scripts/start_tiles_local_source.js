import fs from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'

const ROOT_DIRECTORY = path.resolve(import.meta.dirname, '..')
const ENV_FILE = path.join(ROOT_DIRECTORY, '.env')

const startup_preflight = async () => {
   if (fs.existsSync(ENV_FILE)) {
      process.loadEnvFile(ENV_FILE)
   }

   if (process.env.FRACTO_TILE_SOURCE_MODE && process.env.FRACTO_TILE_SOURCE_MODE !== 'local') {
      throw new Error('FRACTO_TILE_SOURCE_MODE must be unset or set to local for this command')
   }
   process.env.FRACTO_TILE_SOURCE_MODE = 'local'

   const source_directory_value = process.env.FRACTO_TILE_SOURCE_DIR?.trim()
   const source_generation = process.env.FRACTO_TILE_SOURCE_GENERATION?.trim()
   if (!source_directory_value) {
      throw new Error('Set FRACTO_TILE_SOURCE_DIR in the process environment or root .env file')
   }
   if (!path.isAbsolute(source_directory_value)) {
      throw new Error('FRACTO_TILE_SOURCE_DIR must be an absolute path')
   }
   if (!source_generation) {
      throw new Error('Set FRACTO_TILE_SOURCE_GENERATION to the immutable tile dataset identifier')
   }
   process.env.FRACTO_TILE_SOURCE_DIR = source_directory_value
   process.env.FRACTO_TILE_SOURCE_GENERATION = source_generation

   const {validate_local_tile_source} = await import('./startup_preflight.js')
   return validate_local_tile_source()
}

const main = async () => {
   if (process.argv.slice(2).some(argument => argument !== '--check')) {
      throw new Error('Usage: npm run start:tiles-local-source [-- --check]')
   }
   const result = await startup_preflight()
   console.log(
      `Local tile-source preflight passed (generation ${result.source_generation}; ` +
      `${result.packet_count} compiled packets; representative tile ${result.representative_short_code}).`,
   )
   if (process.argv.includes('--check')) return

   const child = spawn(
      process.execPath,
      [path.join('scripts', 'launch_service.js'), 'fracto-tiles-server'],
      {cwd: ROOT_DIRECTORY, env: process.env, stdio: 'inherit', shell: false},
   )
   child.once('error', error => {
      console.error(`Unable to start the tile service: ${error.message}`)
      process.exitCode = 1
   })
   child.once('exit', (code, signal) => {
      process.exitCode = code ?? (signal ? 1 : 0)
   })
   const forward_signal = signal => {
      if (!child.killed) child.kill(signal)
   }
   process.once('SIGINT', () => forward_signal('SIGINT'))
   process.once('SIGTERM', () => forward_signal('SIGTERM'))
}

main().catch(error => {
   console.error(`Local tile-source startup failed: ${error.message}`)
   process.exitCode = 1
})
