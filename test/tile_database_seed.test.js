import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  prepare_tile_snapshot,
  open_tile_snapshot,
  verify_tile_snapshot,
} from "../servers/fracto-tiles-server/tile_seed_snapshot.js";
import {
  open_tile_listing,
  tile_code_batches,
  tile_seek_batches,
} from "../servers/fracto-tiles-server/tile_seed_source.js";
import {
  load_tile_batch,
  prepare_tile_table,
  tile_tsv_row,
} from "../servers/fracto-tiles-server/tile_seed_database.js";

const batches = async (text, options) => {
  const result = [];
  for await (const codes of tile_code_batches(Readable.from([text]), options))
    result.push(codes);
  return result;
};

test("CSV is streamed in sorted bounded batches, retaining leading zeros and final rows", async () => {
  assert.deepEqual(
    await batches('short_code\r\n"31.gz"\r\n001\r\n12\r\n', { batch_size: 2 }),
    [["001", "31"], ["12"]],
  );
  assert.deepEqual(
    await batches("short_code\n3\n2\n1\n0\n", { batch_size: 3, limit: 2 }),
    [["2", "3"]],
  );
});

test("malformed CSV, invalid short codes and source errors fail the import", async () => {
  for (const csv of [
    "wrong\n12\n",
    "short_code,short_code\n12,13\n",
    "short_code\n4\n",
    "short_code\n12,13\n",
    "",
    "short_code\n12\t1\n",
  ])
    await assert.rejects(batches(csv));
  const source = Readable.from(
    (async function* () {
      yield "short_code\n12\n";
      throw new Error("source disconnected");
    })(),
  );
  await assert.rejects(async () => {
    for await (const codes of tile_code_batches(source)) void codes;
  }, /source disconnected/);
  assert.equal(source.destroyed, true);
});

test("metadata matches the existing tile coordinate and folder conventions without filesystem writes", () => {
  assert.equal(
    tile_tsv_row("01230"),
    "01230\t0123\t5\t/0123\t-0.75\t1.25\t-0.625\t1.125\n",
  );
  assert.equal(tile_tsv_row("0"), "0\t\t1\t/\t-2\t2\t0\t0\n");
  assert.equal(tile_tsv_row("0123").split("\t")[3], "/");
  assert.equal(tile_tsv_row("01230123").split("\t")[3], "/0123/0123");
  assert.throws(() => tile_tsv_row("12\n3"), /Invalid tile/);
});

const mock_database = ({
  warnings = [],
  inserted = 2,
  requested = "fracto-tile-batch.tsv",
  query_error,
} = {}) => {
  const events = [];
  return {
    events,
    async beginTransaction() {
      events.push("begin");
    },
    async commit() {
      events.push("commit");
    },
    async rollback() {
      events.push("rollback");
    },
    async query(query) {
      if (typeof query === "string") {
        assert.equal(query, "SHOW WARNINGS LIMIT 65535");
        return [warnings];
      }
      events.push(query.sql);
      const stream = query.infileStreamFactory(requested);
      const payload = [];
      for await (const chunk of stream) {
        assert.ok(Buffer.isBuffer(chunk), "mysql2 requires byte buffers");
        payload.push(chunk);
      }
      this.payload = Buffer.concat(payload).toString("utf8");
      if (query_error) throw query_error;
      return [{ affectedRows: inserted, warningStatus: warnings.length }];
    },
  };
};

test("bulk loading supplies one in-memory TSV stream and commits one transaction", async () => {
  const db = mock_database();
  assert.deepEqual(await load_tile_batch(db, "tiles_seed", ["001", "12"]), {
    inserted: 2,
    existing: 0,
  });
  assert.match(
    db.events[1],
    /LOAD DATA LOCAL INFILE.*IGNORE INTO TABLE `tiles_seed`/s,
  );
  assert.equal(db.payload, tile_tsv_row("001") + tile_tsv_row("12"));
  assert.equal(db.events.at(-1), "commit");
});

test("duplicate keys are skipped but conversion warnings and query errors roll back", async () => {
  const duplicate = mock_database({ inserted: 1, warnings: [{ Code: 1062 }] });
  assert.deepEqual(await load_tile_batch(duplicate, "tiles", ["001", "12"]), {
    inserted: 1,
    existing: 1,
  });
  for (const options of [
    { warnings: [{ Code: 1265 }] },
    { query_error: new Error("load failed") },
    { inserted: 3 },
  ]) {
    const db = mock_database(options);
    await assert.rejects(load_tile_batch(db, "tiles", ["001", "12"]));
    assert.equal(db.events.at(-1), "rollback");
    assert.ok(!db.events.includes("commit"));
  }
});

test("server-requested local paths and unsafe identifiers are rejected", async () => {
  const db = mock_database({ requested: "config/mysql.json", inserted: 0 });
  await assert.rejects(
    load_tile_batch(db, "tiles", ["12"]),
    /unexpected infile/,
  );
  assert.equal(db.payload, "");
  assert.equal(db.events.at(-1), "rollback");
  await assert.rejects(
    load_tile_batch(db, "tiles; DROP TABLE tiles", ["12"]),
    /Invalid target/,
  );
});

test("disabled LOCAL INFILE selects batched insert without global setting changes", async () => {
  const queries = [];
  const db = {
    async query(sql) {
      queries.push(sql);
      if (sql.startsWith("SELECT @@")) return [[{ local_infile: 0 }]];
      if (sql.startsWith("SELECT ENGINE")) return [[{ ENGINE: "InnoDB" }]];
      if (sql.startsWith("SHOW INDEX"))
        return [
          [{ Key_name: "PRIMARY", Column_name: "short_code", Non_unique: 0 }],
        ];
      return [{}];
    },
  };
  assert.equal(
    await prepare_tile_table(db, { table: "tiles", method: "auto" }),
    "insert",
  );
  assert.ok(!queries.some((sql) => /GLOBAL|CREATE|DROP|ALTER/.test(sql)));
  await assert.rejects(
    prepare_tile_table(db, { table: "tiles", method: "load-data" }),
    /local_infile is disabled/,
  );
});

test("seed setup creates only the primary key and refuses incompatible existing tables", async () => {
  const primary = {
    Key_name: "PRIMARY",
    Column_name: "short_code",
    Non_unique: 0,
    Sub_part: null,
  };
  for (const scenario of [
    "good",
    "disabled",
    "myisam",
    "prefix",
    "secondary",
    "unique",
  ]) {
    const queries = [];
    const db = {
      async query(sql) {
        queries.push(sql);
        if (sql.startsWith("SELECT @@"))
          return [[{ local_infile: scenario !== "disabled" ? 1 : 0 }]];
        if (sql.startsWith("SELECT ENGINE"))
          return [[{ ENGINE: scenario === "myisam" ? "MyISAM" : "InnoDB" }]];
        if (sql.startsWith("SHOW INDEX"))
          return [
            [
              { ...primary, Sub_part: scenario === "prefix" ? 10 : null },
              ...(["secondary", "unique"].includes(scenario)
                ? [
                    {
                      Key_name: "folder",
                      Column_name: "folder",
                      Non_unique: scenario === "unique" ? 0 : 1,
                    },
                  ]
                : []),
            ],
          ];
        return [{}];
      },
    };
    if (scenario === "good") {
      await prepare_tile_table(db, { table: "tiles_seed", seed: true });
      const ddl = queries.find((sql) => sql.startsWith("CREATE TABLE"));
      assert.match(ddl, /PRIMARY KEY \(short_code\)/);
      assert.doesNotMatch(ddl, /UNIQUE KEY|DROP|ALTER/);
    } else
      await assert.rejects(
        prepare_tile_table(db, {
          table: "tiles_seed",
          seed: true,
          method: "load-data",
        }),
      );
  }
});

test("remote CSV uses the configured listing and reports HTTP errors", async () => {
  const old_mode = process.env.FRACTO_TILE_SOURCE_MODE;
  const old_base = process.env.FRACTO_TILE_REMOTE_BASE_URL;
  let status = 200;
  const server = createServer((request, response) => {
    assert.equal(request.url, "/manifest/indexed.csv");
    response.writeHead(status);
    response.end(status === 200 ? "short_code\n001\n" : "unavailable");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    process.env.FRACTO_TILE_SOURCE_MODE = "remote-cache";
    process.env.FRACTO_TILE_REMOTE_BASE_URL = `http://127.0.0.1:${server.address().port}/`;
    const result = [];
    for await (const codes of tile_code_batches(await open_tile_listing()))
      result.push(...codes);
    assert.deepEqual(result, ["001"]);
    status = 503;
    await assert.rejects(open_tile_listing(), /HTTP 503/);
  } finally {
    for (const [key, value] of [
      ["FRACTO_TILE_SOURCE_MODE", old_mode],
      ["FRACTO_TILE_REMOTE_BASE_URL", old_base],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise((resolve) => server.close(resolve));
  }
});

const with_snapshot_directory = async (callback) => {
  const prefix = path.join(tmpdir(), "fracto-seed-checkpoint-");
  const directory = await mkdtemp(prefix);
  try {
    await callback(directory);
  } finally {
    if (!path.resolve(directory).startsWith(path.resolve(prefix)))
      throw new Error("Unexpected temp path");
    await rm(directory, { recursive: true, force: true });
  }
};

test("byte checkpoints seek across CRLF, multiline CSV, UTF-8, sorted batches and final rows without LF", async () => {
  await with_snapshot_directory(async (directory) => {
    const filename = path.join(directory, "indexed.csv");
    const prefix = 'short_code,note\r\n31,"a\r\nb"\r\n001,é\r\n';
    const text = prefix + "12,last";
    await writeFile(filename, text);
    const snapshot = await prepare_tile_snapshot(filename);
    const initial = [];
    for await (const batch of tile_seek_batches(
      open_tile_snapshot(snapshot, 0),
      {
        ...snapshot,
        batch_size: 2,
        limit: 2,
      },
    ))
      initial.push(batch);
    assert.deepEqual(initial, [
      { codes: ["001", "31"], byte_offset: Buffer.byteLength(prefix) },
    ]);
    const resumed = [];
    for await (const batch of tile_seek_batches(
      open_tile_snapshot(snapshot, initial[0].byte_offset),
      {
        ...snapshot,
        byte_offset: initial[0].byte_offset,
        batch_size: 1,
      },
    ))
      resumed.push(batch);
    assert.deepEqual(resumed, [
      { codes: ["12"], byte_offset: Buffer.byteLength(text) },
    ]);
    await verify_tile_snapshot(snapshot);
    await writeFile(filename, text + "\n13,new");
    await assert.rejects(verify_tile_snapshot(snapshot), /CSV changed/);
    assert.notEqual(
      (await prepare_tile_snapshot(filename)).identity,
      snapshot.identity,
    );
  });
});

test("remote checkpoint resumes its pinned snapshot without another HTTP request", async () => {
  await with_snapshot_directory(async (directory) => {
    const old_mode = process.env.FRACTO_TILE_SOURCE_MODE;
    const old_base = process.env.FRACTO_TILE_REMOTE_BASE_URL;
    let requests = 0;
    const server = createServer((request, response) => {
      requests++;
      response.end("short_code\n001\n12\n");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      process.env.FRACTO_TILE_SOURCE_MODE = "remote-cache";
      process.env.FRACTO_TILE_REMOTE_BASE_URL = `http://127.0.0.1:${server.address().port}`;
      const first = await prepare_tile_snapshot(undefined, {
        cache_dir: directory,
      });
      const resumed = await prepare_tile_snapshot(undefined, {
        previous: first,
        cache_dir: directory,
      });
      assert.equal(resumed.identity, first.identity);
      assert.equal(requests, 1);
      const restarted = await prepare_tile_snapshot(undefined, {
        previous: first,
        restart: true,
        cache_dir: directory,
      });
      assert.equal(requests, 2);
      assert.notEqual(restarted.filename, first.filename);
    } finally {
      for (const [key, value] of [
        ["FRACTO_TILE_SOURCE_MODE", old_mode],
        ["FRACTO_TILE_REMOTE_BASE_URL", old_base],
      ]) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test("checkpoint saves happen before commit and a checkpoint failure rolls back the tile batch", async () => {
  const success = mock_database();
  await load_tile_batch(
    success,
    "tiles",
    ["001", "12"],
    "load-data",
    async (counts) => {
      assert.equal(counts.inserted, 2);
      success.events.push("checkpoint");
    },
  );
  assert.deepEqual(success.events.slice(-2), ["checkpoint", "commit"]);
  const failure = mock_database();
  await assert.rejects(
    load_tile_batch(failure, "tiles", ["001", "12"], "load-data", async () => {
      throw new Error("checkpoint write failed");
    }),
    /checkpoint write failed/,
  );
  assert.equal(failure.events.at(-1), "rollback");
  assert.ok(!failure.events.includes("commit"));
});
