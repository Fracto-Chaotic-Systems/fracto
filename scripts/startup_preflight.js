import fs from 'node:fs'
import path from 'node:path'
import mysql from 'mysql2/promise'

import {ALL_SERVICES, SERVICE_NAME_UI} from '../constants.js'

const ROOT_DIRECTORY = path.join(import.meta.dirname, '..')
const DATABASE_CONNECT_TIMEOUT_MS = 5000

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
