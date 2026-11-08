import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import config from "../config/mysql.json" with { type: "json" };
import { load_mapping_rows } from "../scripts/wordnet_mapping_seed.js";
import { compatible_migration_sql } from "../scripts/database_migration_compatibility.js";

test(
  "006 executes across UTF-8 collation defaults, preserves existing notes and names, and retries without duplicates",
  { skip: process.env.FRACTO_TEST_MYSQL_MIGRATIONS !== "1" },
  async () => {
    const schema = `fracto_migration_verify_${randomBytes(6).toString("hex")}`;
    const db = await mysql.createConnection({
      ...config,
      host: process.env.FRACTO_MYSQL_HOST || config.host,
      port: Number(process.env.FRACTO_MYSQL_PORT || config.port || 3306),
      charset: "utf8mb4_unicode_ci",
      dateStrings: true,
    });
    try {
      assert.match(schema, /^fracto_migration_verify_[a-f0-9]{12}$/);
      await db.query(
        `CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`,
      );
      await db.changeUser({ database: schema });
      await db.query(
        "CREATE TABLE wordnet_mappings (cardinality BIGINT UNSIGNED PRIMARY KEY,synset_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,notes TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,world_name VARCHAR(255) NOT NULL) ENGINE=InnoDB",
      );
      const mappings = await load_mapping_rows();
      const old_marker =
        "Existing café 🌍\nworld name suggestions (unapproved): already reviewed";
      await db.query(
        "INSERT INTO wordnet_mappings VALUES " +
          mappings.map(() => "(?,?,?,?)").join(","),
        mappings.flatMap((row, index) => [
          row.cardinality,
          row.synset_id,
          index === 0 ? old_marker : "Existing café 🌍",
          "Existing world",
        ]),
      );
      const original = await readFile(
        new URL(
          "../database/migrations/006_world-name-suggestions.sql",
          import.meta.url,
        ),
        "utf8",
      );
      const prepared = compatible_migration_sql(
        "006_world-name-suggestions.sql",
        original,
      );
      for (const collation of ["utf8mb4_general_ci", "utf8mb4_unicode_ci"]) {
        await db.query(`SET NAMES utf8mb4 COLLATE ${collation}`);
        await db.query(prepared);
        const [rows] = await db.query(
          "SELECT cardinality,synset_id,notes,world_name FROM wordnet_mappings ORDER BY cardinality",
        );
        assert.equal(rows.length, 318);
        assert.equal(
          rows[0].notes,
          old_marker,
          "case-insensitive existing marker remains protected",
        );
        for (const row of rows.slice(1)) {
          assert.ok(
            row.notes.startsWith(
              "Existing café 🌍\n\nWorld name suggestions (unapproved):\n",
            ),
          );
          assert.equal(row.world_name, "Existing world");
        }
        await db.query(prepared);
        const [replayed] = await db.query(
          "SELECT cardinality,synset_id,notes,world_name FROM wordnet_mappings ORDER BY cardinality",
        );
        assert.deepEqual(replayed, rows);
      }
    } finally {
      try {
        if (/^fracto_migration_verify_[a-f0-9]{12}$/.test(schema))
          await db.query(`DROP DATABASE IF EXISTS \`${schema}\``);
      } finally {
        await db.end();
      }
    }
  },
);
