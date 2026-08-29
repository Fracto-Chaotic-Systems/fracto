import fs from 'node:fs'
import path from 'node:path'
import {promises as fsp} from 'node:fs'

import {tile_index_paths, resolve_tile_index_base} from '../sdk/FractoTilePaths.js'

const source_directory = path.resolve(process.argv[2] || '/legacy-tiles')
const destination_directory = path.resolve(process.argv[3] || '/var/lib/fracto/tiles')
const concurrency = Math.max(1, Number(process.env.FRACTO_MIGRATION_CONCURRENCY || 8))

const stats = {indexed: 0, moved: 0, skipped: 0, missing: 0, errors: 0}
const started_at = Date.now()
let last_report = started_at

const tile_path = (root, short_code) => {
   const pieces = short_code.match(/.{1,4}/g)
   if (!pieces) return null
   if (pieces.at(-1).length < 4) pieces.pop()
   return path.join(root, ...pieces, `${short_code}.gz`)
}

const report = force => {
   const now = Date.now()
   if (!force && now - last_report < 60000) return
   const elapsed_minutes = Math.max((now - started_at) / 60000, 1 / 60)
   const rate = Math.round(stats.indexed / elapsed_minutes)
   console.log(`Index migration: ${stats.indexed} examined, ${stats.moved} moved, ${stats.skipped} already present, ${stats.missing} missing (${rate}/min)`)
   last_report = now
}

const exists = async file_path => {
   try {
      await fsp.access(file_path, fs.constants.F_OK)
      return true
   } catch {
      return false
   }
}

const move_one = async short_code => {
   const source_file = tile_path(source_directory, short_code)
   const destination_file = tile_path(destination_directory, short_code)
   if (!source_file || !destination_file) return
   try {
      if (await exists(destination_file)) {
         if (await exists(source_file)) await fsp.unlink(source_file)
         stats.skipped++
         return
      }
      if (!await exists(source_file)) {
         stats.missing++
         return
      }
      await fsp.mkdir(path.dirname(destination_file), {recursive: true})
      const temporary_file = `${destination_file}.migrating-${process.pid}-${Date.now()}`
      try {
         await fsp.rename(source_file, destination_file)
      } catch (error) {
         if (error.code !== 'EXDEV') throw error
         await fsp.copyFile(source_file, temporary_file)
         await fsp.rename(temporary_file, destination_file)
         await fsp.unlink(source_file)
      }
      stats.moved++
   } catch (error) {
      stats.errors++
      console.error(`Unable to migrate ${short_code}: ${error.message}`)
   }
}

const run_batch = async short_codes => {
   let cursor = 0
   const worker = async () => {
      while (cursor < short_codes.length) {
         const short_code = short_codes[cursor++]
         await move_one(short_code)
         stats.indexed++
         if (stats.indexed % 100 === 0) {
            console.log(`Processed ${stats.indexed} indexed tiles`)
            report(false)
         }
      }
   }
   await Promise.all(Array.from({length: concurrency}, worker))
}

const promote_directories = async () => {
   await fsp.mkdir(destination_directory, {recursive: true})
   const promoted = new Set()
   const entries = await fsp.readdir(source_directory, {withFileTypes: true})
   for (const entry of entries) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
      const source_path = path.join(source_directory, entry.name)
      const destination_path = path.join(destination_directory, entry.name)
      if (fs.existsSync(destination_path)) continue
      try {
         await fsp.rename(source_path, destination_path)
         promoted.add(entry.name)
         console.log(`Promoted legacy directory ${entry.name}`)
      } catch (error) {
         if (error.code !== 'EXDEV') throw error
         console.log(`Keeping ${entry.name} for per-tile migration (source and destination use different filesystems)`)
      }
   }
   return promoted
}

const run = async () => {
   if (!fs.existsSync(source_directory)) throw new Error(`Legacy tile cache not found: ${source_directory}`)
   const index_base = resolve_tile_index_base({require_complete: true})
   const {source} = tile_index_paths({require_complete: true})
   const manifest_path = path.join(source, 'packet_manifest.json')
   const manifest = JSON.parse(await fsp.readFile(manifest_path, 'utf8'))
   if (!Array.isArray(manifest.packet_files) || !manifest.packet_files.length) {
      throw new Error(`Tile index manifest is empty: ${manifest_path}`)
   }
   console.log(`Using completed tile index at ${index_base}`)
   console.log(`Migrating with concurrency ${concurrency}`)
   const promoted = await promote_directories()
   for (const packet_file of manifest.packet_files) {
      const packet = JSON.parse(await fsp.readFile(path.join(source, packet_file), 'utf8'))
      const short_codes = []
      for (const column of packet.columns || []) {
         for (const tile of column.tiles || []) {
            const short_code = tile.short_code
            const pieces = short_code?.match(/.{1,4}/g)
            if (pieces && !promoted.has(pieces[0])) short_codes.push(short_code)
         }
      }
      await run_batch(short_codes)
   }
   report(true)
   console.log(`Tile index migration complete: ${stats.moved} moved, ${stats.skipped} already present, ${stats.missing} missing, ${stats.errors} errors`)
   if (stats.errors) process.exitCode = 1
}

run().catch(error => {
   console.error(`Tile index migration failed: ${error.message}`)
   process.exitCode = 1
})
