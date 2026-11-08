import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { load_mapping_rows } from "../scripts/wordnet_mapping_seed.js";
import { compatible_migration_sql } from "../scripts/database_migration_compatibility.js";

test(
  "006 and 011 execute across collation defaults, preserve existing rows, and retry safely",
  { skip: process.env.FRACTO_TEST_MYSQL_MIGRATIONS !== "1" },
  async () => {
    const { default: mysql } = await import("mysql2/promise");
    const { normalize_backup_collations } =
      await import("../scripts/database_collation_compatibility.js");
    const config = JSON.parse(
      await readFile(new URL("../config/mysql.json", import.meta.url), "utf8"),
    );
    const schema = `fracto_migration_verify_${randomBytes(6).toString("hex")}`;
    const db = await mysql.createConnection({
      ...config,
      host: process.env.FRACTO_MYSQL_HOST || config.host,
      port: Number(process.env.FRACTO_MYSQL_PORT || config.port || 3306),
      charset: "utf8mb4_unicode_ci",
      dateStrings: true,
      multipleStatements: true,
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
      await db.query(
        "CREATE TABLE videos (id INT PRIMARY KEY,archived TINYINT(1) NOT NULL DEFAULT 0,script_version INT NOT NULL) ENGINE=InnoDB",
      );
      await db.query("INSERT INTO videos VALUES (1,1,3)");
      const [before] = await db.query(
        "SELECT id,archived,script_version FROM videos",
      );
      const baseline = await readFile(
        new URL(
          "../database/migrations/011_sync-baseline-tables.sql",
          import.meta.url,
        ),
        "utf8",
      );
      const prepared_baseline = normalize_backup_collations(
        compatible_migration_sql("011_sync-baseline-tables.sql", baseline),
        new Set(["utf8mb4_unicode_520_ci"]),
      );
      for (let attempt = 0; attempt < 2; attempt++)
        await db.query(prepared_baseline);
      const [after] = await db.query(
        "SELECT id,archived,script_version FROM videos",
      );
      assert.deepEqual(
        after,
        before,
        "011 fallback and retry preserve existing video rows",
      );
      const [tables] = await db.query(
        "SELECT TABLE_NAME AS name,TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME IN ('lore_category','lore_content') ORDER BY TABLE_NAME",
        [schema],
      );
      assert.equal(tables.length, 2);
      assert.ok(
        tables.every((table) => table.collation === "utf8mb4_unicode_520_ci"),
      );
      const [columns] = await db.query("SHOW COLUMNS FROM videos");
      assert.deepEqual(
        columns.map((column) => column.Field),
        ["id", "script_version", "archived"],
      );
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
