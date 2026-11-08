import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { compatible_migration_sql } from "../scripts/database_migration_compatibility.js";

test("006 execution uses explicit Unicode collation without changing its seed or any other migration", async () => {
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
  assert.match(
    prepared,
    /LOCATE\(CONVERT\(0x[0-9a-f]+ USING utf8mb4\) COLLATE utf8mb4_unicode_ci, mappings\.notes COLLATE utf8mb4_unicode_ci\)/,
  );
  assert.equal(
    prepared.replaceAll(" COLLATE utf8mb4_unicode_ci", ""),
    original,
  );
  assert.equal(compatible_migration_sql("012_example.sql", original), original);
  assert.throws(
    () =>
      compatible_migration_sql("006_world-name-suggestions.sql", "SELECT 1;"),
    /guard was not found/,
  );
});
