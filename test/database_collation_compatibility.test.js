import assert from 'node:assert/strict'
import test from 'node:test'

import {normalize_backup_collations} from '../scripts/database_collation_compatibility.js'

const mysql_8_dump = 'CREATE TABLE sample (name VARCHAR(20)) COLLATE=utf8mb4_0900_ai_ci;'

test('preserves MySQL 8 backup collations when the server supports them', () => {
   assert.equal(
      normalize_backup_collations(mysql_8_dump, new Set(['utf8mb4_0900_ai_ci'])),
      mysql_8_dump,
   )
})

test('maps unsupported MySQL 8 backup collations to MariaDB Unicode 5.2', () => {
   assert.equal(
      normalize_backup_collations(mysql_8_dump, new Set(['utf8mb4_unicode_520_ci'])),
      'CREATE TABLE sample (name VARCHAR(20)) COLLATE=utf8mb4_unicode_520_ci;',
   )
})

test('fails clearly if the SQL backup collation has no supported substitute', () => {
   assert.throws(
      () => normalize_backup_collations(mysql_8_dump, new Set()),
      /does not support utf8mb4_0900_ai_ci or utf8mb4_unicode_520_ci/,
   )
})


import crypto from 'node:crypto'
import {migration_checksum_matches} from '../scripts/database_migration_checksums.js'
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

test('applied migration checksums accept exact bytes and LF/CRLF equivalents in both directions', () => {
   const lf = Buffer.from('-- café\nSELECT 1;\n'), crlf = Buffer.from('-- café\r\nSELECT 1;\r\n')
   for (const current of [lf, crlf]) for (const recorded of [lf, crlf])
      assert.equal(migration_checksum_matches(current, hash(recorded)), true)
})

test('applied migration checksums reject SQL edits, whitespace edits and removed final newlines', () => {
   const original = Buffer.from('SELECT 1;\n')
   for (const changed of ['SELECT 2;\n', 'SELECT  1;\n', 'SELECT 1;', 'SELECT 1;\n\n'])
      assert.equal(migration_checksum_matches(Buffer.from(changed), hash(original)), false)
   assert.equal(migration_checksum_matches(original, 'invalid'), false)
})
