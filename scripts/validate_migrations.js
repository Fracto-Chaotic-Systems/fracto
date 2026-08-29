import fs from 'node:fs'
import path from 'node:path'

import {ROOT_DIR} from '../constants.js'

const migration_directory = path.resolve(
   process.env.FRACTO_DB_MIGRATION_DIR || path.join(ROOT_DIR, 'database', 'migrations'),
)
const filename_pattern = /^(\d{3,})_[A-Za-z0-9-]+\.sql$/
const forbidden_statements = /\bDROP\s+DATABASE\b|\bTRUNCATE\s+(?:TABLE\s+)?/i

if (!fs.existsSync(migration_directory)) {
   throw new Error(`Migration directory not found: ${migration_directory}`)
}

const files = fs.readdirSync(migration_directory)
   .filter(name => name.endsWith('.sql'))
   .sort()
if (!files.includes('001_baseline.sql')) throw new Error('Required migration 001_baseline.sql is missing')

const versions = new Set()
for (const filename of files) {
   const match = filename.match(filename_pattern)
   if (!match) throw new Error(`Invalid migration filename: ${filename}`)
   if (versions.has(match[1])) throw new Error(`Duplicate migration version: ${match[1]}`)
   versions.add(match[1])

   const sql = fs.readFileSync(path.join(migration_directory, filename), 'utf8')
   if (!sql.trim()) throw new Error(`Migration is empty: ${filename}`)
   if (forbidden_statements.test(sql)) {
      throw new Error(`Migration contains a destructive statement that is not allowed: ${filename}`)
   }
}

console.log(`Migration validation passed for ${files.length} file(s).`)
