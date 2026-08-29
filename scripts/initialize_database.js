import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import mysql from 'mysql2/promise'

import config from '../config/mysql.json' with {type: 'json'}
import {ROOT_DIR} from '../constants.js'

const database = process.env.FRACTO_MYSQL_DATABASE || config.database
const backup_directory = path.resolve(process.env.FRACTO_DB_BACKUP_DIR || path.join(ROOT_DIR, 'backup'))
const migration_directory = path.resolve(process.env.FRACTO_DB_MIGRATION_DIR || path.join(ROOT_DIR, 'database', 'migrations'))
const host = process.env.FRACTO_MYSQL_HOST || config.host
const port = process.env.FRACTO_MYSQL_PORT ? Number(process.env.FRACTO_MYSQL_PORT) : Number(config.port || 3306)
const baseline_version = '001_baseline.sql'
const migrations_table = 'fracto_schema_migrations'

if (!database || !/^[A-Za-z0-9_$-]+$/.test(database)) throw new Error('FRACTO_MYSQL_DATABASE must be a valid database name')
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('FRACTO_MYSQL_PORT must be a valid TCP port')
if (!fs.existsSync(backup_directory)) throw new Error(`Database backup directory not found: ${backup_directory}`)
if (!fs.existsSync(migration_directory)) throw new Error(`Database migration directory not found: ${migration_directory}`)

const connection_options = {...config, host, port, database, multipleStatements: true}
const admin_options = {...connection_options}
delete admin_options.database
const identifier = value => `\`${value.replaceAll('`', '``')}\``
const backup_files = fs.readdirSync(backup_directory).filter(name => name.endsWith('.sql')).sort()
const migration_files = fs.readdirSync(migration_directory).filter(name => name.endsWith('.sql')).sort()

if (!backup_files.length) throw new Error(`No SQL backups found in ${backup_directory}`)
if (!migration_files.includes(baseline_version)) throw new Error(`Required baseline migration is missing: ${baseline_version}`)
if (migration_files.some(name => !/^\d{3,}_[A-Za-z0-9-]+\.sql$/.test(name))) throw new Error('Migration files must use the format NNN_description.sql')

const checksum = filepath => crypto.createHash('sha256').update(fs.readFileSync(filepath)).digest('hex')

const ensure_migrations_table = async connection => {
   await connection.query(`CREATE TABLE IF NOT EXISTS ${identifier(migrations_table)} (
      version VARCHAR(255) NOT NULL PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`)
}

const record_migration = async (connection, filename, file_checksum) => {
   await connection.query(`INSERT INTO ${identifier(migrations_table)} (version, checksum) VALUES (?, ?)`, [filename, file_checksum])
}

const apply_migrations = async (connection, existing_database) => {
   await ensure_migrations_table(connection)
   const [applied_rows] = await connection.query(`SELECT version, checksum FROM ${identifier(migrations_table)}`)
   const applied = new Map(applied_rows.map(row => [row.version, row.checksum]))

   for (const filename of migration_files) {
      const filepath = path.join(migration_directory, filename)
      const file_checksum = checksum(filepath)
      if (applied.has(filename)) {
         if (applied.get(filename) !== file_checksum) throw new Error(`Migration ${filename} was changed after it was applied`)
         continue
      }
      if (existing_database && filename === baseline_version) {
         await record_migration(connection, filename, file_checksum)
         console.log(`Recorded existing database baseline ${filename}.`)
         continue
      }
      console.log(`Applying migration ${filename}...`)
      await connection.query(fs.readFileSync(filepath, 'utf8'))
      await record_migration(connection, filename, file_checksum)
   }
}

const admin_connection = await mysql.createConnection(admin_options)
await admin_connection.query(`CREATE DATABASE IF NOT EXISTS ${identifier(database)} CHARACTER SET utf8mb4`)
await admin_connection.end()

const connection = await mysql.createConnection(connection_options)
try {
   const [tables] = await connection.query('SHOW TABLES')
   const existing_database = tables.length > 0
   if (!existing_database) {
      for (const filename of backup_files) {
         console.log(`Loading ${filename}...`)
         await connection.query(fs.readFileSync(path.join(backup_directory, filename), 'utf8'))
      }
      console.log(`Database ${database} bootstrapped from ${backup_files.length} SQL files.`)
   } else if (process.env.FRACTO_DB_INIT_CONFIRM === 'reset') {
      throw new Error('Destructive database reloads are no longer supported; create a numbered migration instead')
   } else {
      console.log(`Database ${database} already contains tables; applying pending migrations only.`)
   }
   await apply_migrations(connection, existing_database)
} finally {
   await connection.end()
}
console.log(`Database ${database} is up to date.`)
