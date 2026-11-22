import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { database_migration_files } from "../scripts/database_migration_files.js";

test("migration discovery merges service ownership, rejects duplicate versions and isolates overrides", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "fracto-migration-discovery-"),
  );
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("fracto-migration-discovery-"));
    await rm(root, { recursive: true, force: true });
  });
  const legacy = path.join(root, "database/migrations");
  const service = path.join(root, "servers/example/database/migrations");
  await mkdir(legacy, { recursive: true });
  await mkdir(service, { recursive: true });
  await writeFile(path.join(legacy, "001_baseline.sql"), "SELECT 1;");
  await writeFile(path.join(service, "002_example.sql"), "SELECT 2;");
  assert.deepEqual(
    [...database_migration_files({ root }).keys()],
    ["001_baseline.sql", "002_example.sql"],
  );
  assert.deepEqual(
    [...database_migration_files({ root, override: legacy }).keys()],
    ["001_baseline.sql"],
  );
  await writeFile(path.join(service, "001_duplicate.sql"), "SELECT 3;");
  assert.throws(
    () => database_migration_files({ root }),
    /Duplicate migration version/,
  );
});
