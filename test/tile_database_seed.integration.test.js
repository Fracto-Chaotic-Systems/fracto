import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  open_tile_checkpoint,
  advance_tile_checkpoint,
} from "../servers/fracto-tiles-server/tile_seed_checkpoint.js";
import {
  prepare_tile_snapshot,
  open_tile_snapshot,
} from "../servers/fracto-tiles-server/tile_seed_snapshot.js";
import { tile_seek_batches } from "../servers/fracto-tiles-server/tile_seed_source.js";
import {
  load_tile_batch,
  prepare_tile_table,
} from "../servers/fracto-tiles-server/tile_seed_database.js";

test(
  "MySQL bulk load preserves leading zeros and existing rows, enforces uniqueness and rolls back warnings",
  {
    skip: process.env.FRACTO_TEST_MYSQL_TILE_SEED !== "1",
  },
  async () => {
    const { default: mysql } = await import("mysql2/promise");
    const config = JSON.parse(
      await readFile(new URL("../config/mysql.json", import.meta.url), "utf8"),
    );
    const schema = `fracto_tile_seed_test_${randomBytes(6).toString("hex")}`;
    const db = await mysql.createConnection({
      ...config,
      host: process.env.FRACTO_MYSQL_HOST || config.host,
      port: Number(process.env.FRACTO_MYSQL_PORT || config.port || 3306),
      multipleStatements: false,
      flags: "LOCAL_FILES",
    });
    let created = false;
    try {
      assert.match(schema, /^fracto_tile_seed_test_[a-f0-9]{12}$/);
      await db.query(`CREATE DATABASE \`${schema}\``);
      created = true;
      await db.changeUser({ database: schema });
      const method = await prepare_tile_table(db, {
        table: "tiles_seed",
        seed: true,
      });
      console.log(`Testing MySQL bulk method: ${method}`);
      const codes = ["001", "01230", "01230123"];
      assert.deepEqual(await load_tile_batch(db, "tiles_seed", codes, method), {
        inserted: 3,
        existing: 0,
      });
      await db.query(
        "UPDATE tiles_seed SET folder = '/preserved' WHERE short_code = '001'",
      );
      assert.deepEqual(
        await load_tile_batch(db, "tiles_seed", [...codes, "13", "13"], method),
        { inserted: 1, existing: 4 },
      );
      const [rows] = await db.query(
        "SELECT * FROM tiles_seed ORDER BY short_code",
      );
      assert.equal(rows.length, 4);
      assert.equal(rows[0].short_code, "001");
      assert.equal(rows[0].folder, "/preserved");
      assert.equal(rows[1].folder, "/0123");
      assert.equal(rows[1].bounds_top, 1.25);
      const [indexes] = await db.query("SHOW INDEX FROM tiles_seed");
      assert.deepEqual(
        indexes.map((index) => index.Key_name),
        ["PRIMARY"],
      );
      // Both LOCAL and INSERT IGNORE can downgrade truncation to a warning.
      await db.query("UPDATE tiles_seed SET folder = '/'");
      await db.query(
        "ALTER TABLE tiles_seed MODIFY folder varchar(1) NOT NULL",
      );
      await assert.rejects(
        load_tile_batch(db, "tiles_seed", ["21", "012301"], method),
        /warning/,
      );
      const [[count]] = await db.query(
        "SELECT COUNT(*) AS total FROM tiles_seed",
      );
      assert.equal(
        Number(count.total),
        4,
        "the valid row in the failed batch must also roll back",
      );
    } finally {
      try {
        if (created) await db.query(`DROP DATABASE \`${schema}\``);
      } finally {
        await db.end();
      }
    }
  },
);

test(
  "checkpointed CLI resumes after process exit, rolls back atomically, rejects competing runs and changed sources",
  {
    skip: process.env.FRACTO_TEST_MYSQL_TILE_SEED !== "1",
  },
  async () => {
    const { default: mysql } = await import("mysql2/promise");
    const config = JSON.parse(
      await readFile(new URL("../config/mysql.json", import.meta.url), "utf8"),
    );
    const connection = {
      ...config,
      host: process.env.FRACTO_MYSQL_HOST || config.host,
      port: Number(process.env.FRACTO_MYSQL_PORT || config.port || 3306),
      multipleStatements: false,
    };
    const schema = `fracto_tile_seed_test_${randomBytes(6).toString("hex")}`;
    const prefix = path.join(tmpdir(), "fracto-seed-cli-");
    const directory = await mkdtemp(prefix);
    const filename = path.join(directory, "indexed.csv");
    const listing = "short_code\r\n001\r\n01230\r\n01230123\r\n13\r\n21";
    await writeFile(filename, listing);
    const cli = fileURLToPath(
      new URL(
        "../servers/fracto-tiles-server/manifest_to_db.js",
        import.meta.url,
      ),
    );
    const run = (...args) =>
      promisify(execFile)(
        process.execPath,
        [cli, "--seed", "--source", filename, ...args],
        {
          env: { ...process.env, FRACTO_MYSQL_DATABASE: schema },
        },
      );
    let db = await mysql.createConnection(connection);
    let created = false;
    try {
      assert.match(schema, /^fracto_tile_seed_test_[a-f0-9]{12}$/);
      await db.query(`CREATE DATABASE \`${schema}\``);
      created = true;
      await db.changeUser({ database: schema });
      await run("--batch-size", "2", "--limit", "2");
      let state = await open_tile_checkpoint(db, "tiles_seed");
      assert.equal(state.processed, 2);
      assert.equal(
        state.byte_offset,
        Buffer.byteLength("short_code\r\n001\r\n01230\r\n"),
      );
      const contender = await mysql.createConnection({
        ...connection,
        database: schema,
      });
      try {
        await assert.rejects(
          open_tile_checkpoint(contender, "tiles_seed"),
          /already loading/,
        );
      } finally {
        await contender.end();
      }
      const snapshot = await prepare_tile_snapshot(filename);
      let next;
      for await (const batch of tile_seek_batches(
        open_tile_snapshot(snapshot, state.byte_offset),
        {
          ...snapshot,
          byte_offset: state.byte_offset,
          batch_size: 2,
        },
      )) {
        next = batch;
        break;
      }
      await assert.rejects(
        load_tile_batch(
          db,
          "tiles_seed",
          next.codes,
          "insert",
          async (counts) => {
            await advance_tile_checkpoint(db, state, next, counts);
            throw new Error("simulated failure before commit");
          },
        ),
        /simulated failure/,
      );
      const [[unchanged]] = await db.query(
        "SELECT processed, byte_offset FROM fracto_tile_seed_checkpoints",
      );
      assert.equal(Number(unchanged.processed), 2);
      assert.equal(Number(unchanged.byte_offset), state.byte_offset);
      const [[count]] = await db.query(
        "SELECT COUNT(*) AS total FROM tiles_seed",
      );
      assert.equal(Number(count.total), 2);
      await db.end(); // Releases the advisory lock; the CLI is a fresh process.
      db = await mysql.createConnection({ ...connection, database: schema });
      const resumed = await run("--batch-size", "1", "--limit", "4");
      assert.match(resumed.stdout, /2 rows committed, resuming at byte/);
      const [[partial]] = await db.query(
        "SELECT processed FROM fracto_tile_seed_checkpoints",
      );
      assert.equal(
        Number(partial.processed),
        4,
        "limit is cumulative, not per restart",
      );
      await run();
      const [[complete]] = await db.query(
        "SELECT processed, byte_offset FROM fracto_tile_seed_checkpoints",
      );
      assert.equal(Number(complete.processed), 5);
      assert.equal(Number(complete.byte_offset), Buffer.byteLength(listing));
      assert.match((await run()).stdout, /0 inserted, 0 existing this run/);
      await writeFile(filename, listing + "\r\n33\r\n");
      await assert.rejects(run(), (error) =>
        /Source differs from the checkpoint/.test(error.stderr),
      );
      await run("--restart");
      const [[restarted]] = await db.query(
        "SELECT processed, inserted, existing FROM fracto_tile_seed_checkpoints",
      );
      assert.equal(Number(restarted.processed), 6);
      assert.equal(Number(restarted.inserted), 1);
      assert.equal(Number(restarted.existing), 5);
    } finally {
      try {
        if (created) await db.query(`DROP DATABASE \`${schema}\``);
      } finally {
        await db.end();
        if (!path.resolve(directory).startsWith(path.resolve(prefix)))
          throw new Error("Unexpected temp path");
        await rm(directory, { recursive: true, force: true });
      }
    }
  },
);
