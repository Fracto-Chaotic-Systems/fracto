import assert from "node:assert/strict";
import test from "node:test";
import {
  create_environment_asset_database,
  environment_asset_row,
  open_environment_asset_pool,
} from "../utils/environment_asset_database.js";

const record = {
  id: "test-grass",
  name: "Grass",
  version: "1.0.0",
  attribution: {
    creator_name: "Creator",
    source_url: "https://example.com/grass",
    license_name: "CC0",
    notes: "Review",
  },
  sources: [
    {
      path: "source/grass.fbx",
      format: "fbx",
      sha256: "a".repeat(64),
      private_extension: "excluded",
    },
  ],
  runtime: { path: "runtime/grass.glb", format: "glb" },
  history: [
    {
      date: "2026-11-22",
      action: "import",
      description: "Imported.",
      account: "excluded",
    },
  ],
  account: "excluded",
};

test("asset rows explicitly retain provenance, model references, checksums and history", () => {
  const row = environment_asset_row(record, "a".repeat(64));
  assert.equal(row.creator_name, "Creator");
  assert.equal(row.license_name, "CC0");
  assert.equal(row.credit_text, null);
  assert.equal(row.model_path, "runtime/grass.glb");
  assert.equal(row.record_path, "test-grass/asset.json");
  assert.equal(JSON.parse(row.sources)[0].sha256, "a".repeat(64));
  assert.equal(
    JSON.parse(row.modification_history)[0].description,
    "Imported.",
  );
  assert.ok(!JSON.stringify(row).includes("excluded"));
});

test(
  "MySQL registry retains edits and preserves timestamps on identical registrations",
  { skip: process.env.FRACTO_TEST_ENVIRONMENT_ASSET_DATABASE !== "1" },
  async () => {
    const pool = await open_environment_asset_pool();
    const connection = await pool.getConnection();
    try {
      // A connection-local copy exercises real column types without editing assets.
      await connection.query(
        "CREATE TEMPORARY TABLE environment_asset_registry_test LIKE environment_assets",
      );
      const registry = create_environment_asset_database({
        open: async () => ({
          execute: (sql, values) =>
            connection.execute(
              sql.replace(
                "INSERT INTO environment_assets",
                "INSERT INTO environment_asset_registry_test",
              ),
              values,
            ),
        }),
      });
      await registry.sync(record, "a".repeat(64));
      const [initial] = await connection.query(
        "SELECT * FROM environment_asset_registry_test WHERE asset_id=?",
        [record.id],
      );
      await registry.sync(record, "a".repeat(64));
      const [repeated] = await connection.query(
        "SELECT * FROM environment_asset_registry_test WHERE asset_id=?",
        [record.id],
      );
      assert.equal(+initial[0].updated_at, +repeated[0].updated_at);
      const changed = structuredClone(record);
      changed.attribution.creator_name = "Updated creator";
      changed.history.push({
        date: "2026-11-22",
        action: "catalog-note",
        description: "Modified structure.",
      });
      await registry.sync(changed, "b".repeat(64));
      const [saved] = await connection.query(
        "SELECT * FROM environment_asset_registry_test WHERE asset_id=?",
        [record.id],
      );
      assert.equal(saved.length, 1);
      assert.equal(saved[0].creator_name, "Updated creator");
      assert.equal(saved[0].revision, "b".repeat(64));
      const history =
        typeof saved[0].modification_history === "string"
          ? JSON.parse(saved[0].modification_history)
          : saved[0].modification_history;
      assert.equal(history.at(-1).description, "Modified structure.");
      assert.equal(+saved[0].created_at, +initial[0].created_at);
    } finally {
      await connection.query(
        "DROP TEMPORARY TABLE IF EXISTS environment_asset_registry_test",
      );
      connection.release();
      await pool.end();
    }
  },
);

test("registry binds values, reuses connections and retries pool creation failures", async () => {
  let attempts = 0,
    closed = false;
  const queries = [];
  const registry = create_environment_asset_database({
    open: async () => {
      if (++attempts === 1) throw new Error("offline");
      return {
        execute: async (...args) => queries.push(args),
        end: async () => {
          closed = true;
        },
      };
    },
  });
  await assert.rejects(registry.sync(record, "a".repeat(64)), /offline/);
  await registry.sync(record, "a".repeat(64));
  await registry.sync(record, "a".repeat(64));
  assert.equal(attempts, 2);
  assert.equal(queries.length, 2);
  assert.match(queries[0][0], /ON DUPLICATE KEY UPDATE/);
  assert.ok(!queries[0][0].includes("Creator"));
  assert.ok(queries[0][1].includes("Creator"));
  await registry.close();
  assert.equal(closed, true);
});
