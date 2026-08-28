import fs from 'node:fs'
import path from 'node:path'
import mysql from 'mysql2/promise'

import config from '../config/mysql.json' with {type: 'json'}
import {ROOT_DIR} from '../constants.js'

const database = process.env.FRACTO_MYSQL_DATABASE || config.database
const backup_directory = path.resolve(
   process.env.FRACTO_DB_BACKUP_DIR || path.join(ROOT_DIR, 'backup'),
)
const host = process.env.FRACTO_MYSQL_HOST || config.host
const port = process.env.FRACTO_MYSQL_PORT
   ? Number(process.env.FRACTO_MYSQL_PORT)
   : (config.port || 3306)

if (!database || !/^[A-Za-z0-9_$-]+$/.test(database)) {
   throw new Error('FRACTO_MYSQL_DATABASE must be a valid database name')
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
   throw new Error('FRACTO_MYSQL_PORT must be a valid TCP port')
}
if (!fs.existsSync(backup_directory)) {
   throw new Error(`Database backup directory not found: ${backup_directory}`)
}

const connection_options = {
   ...config,
   host,
   port,
   database,
   multipleStatements: true,
}
const admin_options = {...connection_options}
delete admin_options.database

const identifier = value => `\`${value.replaceAll('`', '``')}\``
const backup_files = fs.readdirSync(backup_directory)
   .filter(name => name.endsWith('.sql'))
   .sort()

if (!backup_files.length) {
   throw new Error(`No SQL backups found in ${backup_directory}`)
}

const admin_connection = await mysql.createConnection(admin_options)
await admin_connection.query(
   `CREATE DATABASE IF NOT EXISTS ${identifier(database)} CHARACTER SET utf8mb4`,
)
await admin_connection.end()

const connection = await mysql.createConnection(connection_options)
const [tables] = await connection.query('SHOW TABLES')
if (tables.length && process.env.FRACTO_DB_INIT_CONFIRM !== 'reset') {
   await connection.end()
   throw new Error(
      `Database ${database} is not empty; set FRACTO_DB_INIT_CONFIRM=reset to reload its tables`,
   )
}
if (tables.length) {
   await connection.query('SET FOREIGN_KEY_CHECKS=0')
   for (const table of tables) {
      const table_name = Object.values(table)[0]
      await connection.query(`DROP TABLE IF EXISTS ${identifier(table_name)}`)
   }
   await connection.query('SET FOREIGN_KEY_CHECKS=1')
}

for (const filename of backup_files) {
   const filepath = path.join(backup_directory, filename)
   console.log(`Loading ${filename}...`)
   await connection.query(fs.readFileSync(filepath, 'utf8'))
}

await connection.end()
console.log(`Database ${database} initialized from ${backup_files.length} SQL files.`)
