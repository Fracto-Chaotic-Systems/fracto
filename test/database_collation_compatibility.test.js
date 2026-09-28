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
