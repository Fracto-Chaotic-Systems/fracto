import fs from 'node:fs'
import path from 'node:path'
import mysql from 'mysql2/promise'

import {ALL_SERVICES, SERVICE_NAME_UI} from '../constants.js'

const ROOT_DIRECTORY = path.join(import.meta.dirname, '..')
const DATABASE_CONNECT_TIMEOUT_MS = 5000

/** Validates the local tile mount and its compiled-index pairing before startup. */
export const validate_local_tile_source = async () => {
   if (process.env.FRACTO_TILE_SOURCE_MODE !== 'local') return null
   const {TILE_SOURCE_DIRECTORY, TILE_SOURCE_GENERATION} =
      await import('../sdk/FractoTilePaths.js')
   const {validate_tile_index_cache} =
      await import('../sdk/FractoTileIndexCache.js')
   const {validate_tile_source_release} =
      await import('../sdk/FractoTileSource.js')
   const {read_source_tile, tile_source_path} =
      await import('../sdk/FractoTileSource.js')

   let source_stats
   try {
      fs.accessSync(TILE_SOURCE_DIRECTORY, fs.constants.R_OK | fs.constants.X_OK)
      source_stats = fs.statSync(TILE_SOURCE_DIRECTORY)
   } catch {
      throw new Error(
         'FRACTO_TILE_SOURCE_DIR is missing or not readable or searchable; verify the mount and grant the service user read and directory-search permissions',
      )
   }
   if (!source_stats.isDirectory()) {
      throw new Error('FRACTO_TILE_SOURCE_DIR must point to a directory')
   }

   const level_directories = fs.readdirSync(TILE_SOURCE_DIRECTORY, {withFileTypes: true})
      .filter(entry => entry.isDirectory() && /^L\d{2}$/.test(entry.name))
   if (!level_directories.length) {
      throw new Error('Tile source layout is invalid: expected level directories named LNN')
   }
   for (const entry of level_directories) {
      try {
         fs.accessSync(
            path.join(TILE_SOURCE_DIRECTORY, entry.name),
            fs.constants.R_OK | fs.constants.X_OK,
         )
      } catch {
         throw new Error(`Tile source directory ${entry.name} is not readable/searchable by the service user`)
      }
   }

   let index
   try {
      index = validate_tile_index_cache()
   } catch (error) {
      throw new Error(`Compiled tile index preflight failed: ${error.message}`)
   }
   const representative_path = tile_source_path(
      TILE_SOURCE_DIRECTORY,
      index.representative_short_code,
   )
   try {
      fs.accessSync(representative_path, fs.constants.R_OK)
   } catch (error) {
      if (error.code !== 'ENOENT') {
         throw new Error(
            `Indexed representative tile ${index.representative_short_code} is not readable by the service user`,
         )
      }
      const level_directory = `L${String(index.representative_short_code.length).padStart(2, '0')}`
      throw new Error(
         `Tile source is missing indexed representative tile ${index.representative_short_code} under ${level_directory}`,
      )
   }

   let representative_tile
   try {
      representative_tile = read_source_tile(TILE_SOURCE_DIRECTORY, index.representative_short_code)
   } catch (error) {
      throw new Error(
         `Indexed representative tile ${index.representative_short_code} cannot be decoded (${error.kind || 'invalid tile data'})`,
      )
   }
   if (!Array.isArray(representative_tile) || representative_tile.length !== 256 ||
      !Array.isArray(representative_tile[0]) || representative_tile[0].length !== 256 ||
      !Array.isArray(representative_tile[0][0]) || representative_tile[0][0].length !== 2) {
      throw new Error(`Indexed representative tile ${index.representative_short_code} has an invalid tile-data shape`)
   }

   try {
      validate_tile_source_release({
         source_directory: TILE_SOURCE_DIRECTORY,
         source_generation: TILE_SOURCE_GENERATION,
         index_metadata: index.metadata,
         representative_short_code: index.representative_short_code,
      })
   } catch (error) {
      throw new Error(`Tile source/index release preflight failed: ${error.message}`)
   }

   return {
      source_generation: TILE_SOURCE_GENERATION,
      packet_count: index.metadata.packet_count,
      representative_short_code: index.representative_short_code,
   }
}

// Retain the old helper name for scripts and integrations that used it.
export const validate_local_tile_release_pairing = validate_local_tile_source

const database_options = () => {
   const config_path = path.join(ROOT_DIRECTORY, 'config', 'mysql.json')
   if (!fs.existsSync(config_path)) {
      throw new Error('Database configuration is missing: config/mysql.json')
   }

   let config
   try {
      config = JSON.parse(fs.readFileSync(config_path, 'utf8'))
   } catch (error) {
      throw new Error(`Database configuration could not be read: ${error.message}`)
   }

   const host = process.env.FRACTO_MYSQL_HOST || config.host
   const port = process.env.FRACTO_MYSQL_PORT
      ? Number(process.env.FRACTO_MYSQL_PORT)
      : (config.port || 3306)
   const database = process.env.FRACTO_MYSQL_DATABASE || config.database

   if (!host) throw new Error('Database configuration must specify a host')
   if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`Database port is invalid: ${port}`)
   }
   if (!config.user) throw new Error('Database configuration must specify a user')
   if (!database) throw new Error('Database configuration must specify a database')

   return {
      host,
      port,
      user: config.user,
      password: config.password,
      database,
      connectTimeout: DATABASE_CONNECT_TIMEOUT_MS,
   }
}

export const validate_database = async () => {
   const options = database_options()
   let connection
   try {
      connection = await mysql.createConnection(options)
      await connection.query('SELECT 1')
      return `${options.user}@${options.host}:${options.port}/${options.database}`
   } catch (error) {
      const endpoint = `${options.host}:${options.port}`
      if (error.code === 'ECONNREFUSED') {
         throw new Error(`Database is unreachable at ${endpoint}; start MySQL or set FRACTO_MYSQL_HOST/FRACTO_MYSQL_PORT`)
      }
      if (error.code === 'ETIMEDOUT' || error.code === 'PROTOCOL_SEQUENCE_TIMEOUT') {
         throw new Error(`Database connection timed out at ${endpoint}; verify Docker networking and firewall access`)
      }
      if (error.code === 'ER_ACCESS_DENIED_ERROR') {
         throw new Error(`Database rejected credentials for ${options.user} at ${endpoint}; check config/mysql.json`)
      }
      if (error.code === 'ER_BAD_DB_ERROR') {
         throw new Error(`Database ${options.database} does not exist at ${endpoint}; run the database initialization step`)
      }
      throw new Error(`Database preflight failed at ${endpoint}: ${error.message}`)
   } finally {
      if (connection) await connection.end().catch(() => {})
   }
}

export const validate_startup = async () => {
   const errors = []
   const ports = new Set()

   for (const service of ALL_SERVICES) {
      const service_folder = path.join(ROOT_DIRECTORY, 'servers', service.name)
      const package_file = path.join(service_folder, 'package.json')

      if (!Number.isInteger(service.port) || ports.has(service.port)) {
         errors.push(`${service.name}: invalid or duplicate port ${service.port}`)
      }
      ports.add(service.port)

      if (!fs.existsSync(package_file)) {
         errors.push(`${service.name}: missing package.json`)
         continue
      }
      const static_ui = service.name === SERVICE_NAME_UI && process.env.FRACTO_UI_MODE === 'static'
      if (!static_ui && !fs.existsSync(path.join(service_folder, 'node_modules'))) {
         errors.push(`${service.name}: missing node_modules (run npm install in ${service_folder})`)
      }
      if (service.name === SERVICE_NAME_UI) {
         const manifest = JSON.parse(fs.readFileSync(package_file, 'utf8'))
         if (!manifest.scripts?.start) {
            errors.push(`${service.name}: package.json has no start script`)
         }
         if (static_ui && !fs.existsSync(path.join(service_folder, 'dist', 'index.html'))) {
            errors.push(`${service.name}: production build is missing dist/index.html`)
         }
      } else if (!fs.existsSync(path.join(service_folder, 'index.js'))) {
         errors.push(`${service.name}: missing index.js`)
      }
   }

   if (errors.length) {
      throw new Error(`Startup preflight failed:\n- ${errors.join('\n- ')}`)
   }
   try {
      await validate_local_tile_source()
   } catch (error) {
      throw new Error(`Startup preflight failed:\n- Local tile source/index release: ${error.message}`)
   }
   try {
      const database = await validate_database()
      console.log(`Database preflight passed for ${database}.`)
   } catch (error) {
      throw new Error(`Startup preflight failed:\n- ${error.message}`)
   }
   return ALL_SERVICES.length
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
   try {
      const count = await validate_startup()
      console.log(`Startup preflight passed for ${count} services.`)
   } catch (error) {
      console.error(error.message)
      process.exitCode = 1
   }
}
