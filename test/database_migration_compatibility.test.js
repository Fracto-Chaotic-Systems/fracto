import assert from "node:assert/strict";
import test from "node:test";
import {
  readFile,
  mkdtemp,
  mkdir,
  copyFile,
  writeFile,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { compatible_migration_sql } from "../scripts/database_migration_compatibility.js";

test("disabled MySQL integration test skips in a build without private config or database dependencies", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "fracto-migration-build-"),
  );
  try {
    await mkdir(path.join(directory, "test"));
    await mkdir(path.join(directory, "scripts"));
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ type: "module" }),
    );
    for (const file of [
      "test/database_migration_compatibility.integration.test.js",
      "scripts/database_migration_compatibility.js",
      "scripts/wordnet_mapping_seed.js",
    ])
      await copyFile(
        new URL(`../${file}`, import.meta.url),
        path.join(directory, file),
      );
    const env = { ...process.env, FRACTO_TEST_MYSQL_MIGRATIONS: "" };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(
      process.execPath,
      [
        "--test",
        "--test-reporter=tap",
        path.join(
          directory,
          "test/database_migration_compatibility.integration.test.js",
        ),
      ],
      { encoding: "utf8", env },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /# SKIP/);
  } finally {
    assert.ok(
      path
        .resolve(directory)
        .startsWith(path.join(os.tmpdir(), "fracto-migration-build-")),
    );
    await rm(directory, { recursive: true, force: true });
  }
});

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
