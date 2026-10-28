import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { MeshInventoryStore } from "../sdk/terrain/InventoryStore.js";
import { mesh_relative_path } from "../sdk/terrain/Paths.js";
import { build_terrain_tile } from "../sdk/terrain/Mesh.js";
import {
  encode_terrain_mesh,
  terrain_namespace,
  cache_terrain_plan,
} from "../sdk/terrain/Cache.js";
import { create_mesh_handler } from "../servers/fracto-tiles-server/terrain/Access.js";
import { create_terrain_cache_handlers } from "../servers/fracto-tiles-server/terrain/Jobs.js";

const identity = { generation: "persistent-mesh-test" },
  layout = "level";
const source = Array.from({ length: 256 }, () =>
  Array.from({ length: 256 }, () => [2, 42]),
);
const geometry = build_terrain_tile(source);
const fixture = async (run) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "fracto-mesh-inventory-"),
  );
  const root = path.join(directory, "meshes");
  const options = { root, layout, source_identity: identity };
  const write = async (code, source_identity = identity) => {
    const filename = path.join(root, mesh_relative_path(code, layout));
    await fs.mkdir(path.dirname(filename), { recursive: true });
    const { compressed } = encode_terrain_mesh(geometry, {
      short_code: code,
      namespace: terrain_namespace(source_identity),
    });
    await fs.writeFile(filename, compressed);
    return filename;
  };
  try {
    await run({ root, options, write });
  } finally {
    assert.ok(
      path
        .resolve(directory)
        .startsWith(path.join(os.tmpdir(), "fracto-mesh-inventory-")),
    );
    await fs.rm(directory, { recursive: true, force: true });
  }
};
const response = () => ({
  code: 200,
  status(code) {
    this.code = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
  setHeader() {},
  send(body) {
    this.body = body;
    return this;
  },
});
const tick = () => new Promise(setImmediate);

test("journal write failure cannot publish memory changes and requires reopen", async () =>
  fixture(async ({ options, write }) => {
    await write("00");
    const store = await new MeshInventoryStore(options).initialize();
    const revision = store.inventory.revision,
      original = fs.open;
    fs.open = async (...args) => {
      if (String(args[0]) === store.journal.journal_file)
        throw Object.assign(new Error("simulated disk failure"), {
          code: "EIO",
        });
      return original(...args);
    };
    try {
      await assert.rejects(store.begin("00"), { code: "EIO" });
    } finally {
      fs.open = original;
    }
    assert.equal(store.inventory.revision, revision);
    assert.equal(store.inventory.has_ready("00"), true);
    await assert.rejects(store.begin("01"), { code: "EIO" });
    const reopened = await new MeshInventoryStore(options).initialize();
    await reopened.begin("00");
    assert.equal(reopened.inventory.has_ready("00"), false);
    await reopened.recover_pending();
    assert.equal(reopened.inventory.has_ready("00"), true);
  }));

test("snapshot publication survives a journal-compaction failure", async () =>
  fixture(async ({ options, write }) => {
    const store = await new MeshInventoryStore(options).initialize();
    await write("00");
    await store.observe("00");
    const original = fs.rename;
    fs.rename = async (...args) => {
      if (String(args[1]) === store.journal.journal_file)
        throw Object.assign(new Error("simulated compaction interruption"), {
          code: "EIO",
        });
      return original(...args);
    };
    try {
      await assert.rejects(store.recover_pending(), { code: "EIO" });
    } finally {
      fs.rename = original;
    }
    const reopened = await new MeshInventoryStore(options).initialize();
    assert.equal(reopened.inventory.has_ready("00"), true);
    assert.equal(reopened.inventory.revision, store.inventory.revision);
  }));

test("bootstrap scans real meshes and warm startup restores snapshots without decoding files", async () =>
  fixture(async ({ root, options, write }) => {
    await write("00");
    await write("01", { generation: "old" });
    const broken = await write("02");
    await fs.writeFile(broken, "corrupt");
    await fs.mkdir(path.join(root, "manifests"));
    await fs.writeFile(path.join(root, "manifests", "03.gz"), "not a mesh");
    const store = await new MeshInventoryStore(options).initialize();
    assert.equal(store.inventory.summary().ready, 1);
    assert.equal(store.inventory.summary().stale, 1);
    assert.equal(store.inventory.summary().invalid, 1);
    const revision = store.inventory.revision;
    const original = fs.readFile;
    fs.readFile = async (...args) => {
      if (String(args[0]).endsWith(".gz"))
        throw new Error("Warm startup decoded a mesh");
      return original(...args);
    };
    try {
      const restored = await new MeshInventoryStore(options).initialize();
      assert.deepEqual(restored.inventory.summary(), store.inventory.summary());
      assert.equal(restored.inventory.revision, revision);
    } finally {
      fs.readFile = original;
    }
    const changed = await new MeshInventoryStore({
      ...options,
      source_identity: { generation: "new" },
    }).initialize();
    assert.equal(changed.inventory.summary().ready, 0);
    assert.equal(changed.inventory.summary().stale, 2);
  }));

test("uncheckpointed observations replay, pending publications recover, and absent intents never become ready", async () =>
  fixture(async ({ options, write }) => {
    const first = await new MeshInventoryStore(options).initialize();
    await write("00");
    await first.observe("00");
    await first.begin("01");
    await write("01"); // publication followed by process loss
    await first.begin("02"); // process loss before publication
    const revision = first.inventory.revision;
    const recovered = await new MeshInventoryStore(options).initialize();
    assert.equal(recovered.inventory.has_ready("00"), true);
    assert.equal(recovered.inventory.has_ready("01"), true);
    assert.equal(recovered.inventory.has("02"), false);
    assert.ok(recovered.inventory.revision > revision);
    assert.equal(recovered.journal.pending.size, 0);
    assert.equal(recovered.inventory.summary().total, 2);
  }));

test("reconciliation discovers external files, invalidates corruption and removes deletions", async () =>
  fixture(async ({ options, write }) => {
    const file = await write("00");
    const store = await new MeshInventoryStore(options).initialize();
    await fs.unlink(file);
    await write("01");
    const corrupt = await write("02");
    await fs.writeFile(corrupt, "bad");
    const warm = await new MeshInventoryStore(options).initialize();
    assert.equal(warm.inventory.has("00"), true); // explicit external reconciliation required
    assert.equal(warm.inventory.has("01"), false);
    await warm.reconcile();
    assert.equal(warm.inventory.has("00"), false);
    assert.equal(warm.inventory.has_ready("01"), true);
    assert.equal(warm.inventory.get("02").status, "invalid");
    const revision = warm.inventory.revision;
    await warm.reconcile();
    assert.equal(warm.inventory.revision, revision);
    await warm.begin("03");
    await write("03");
    await warm.reconcile({ force: true });
    assert.equal(warm.inventory.has("03"), false); // do not race an active worker
    await warm.observe("03", { complete: true });
    assert.equal(warm.inventory.has_ready("03"), true);
  }));

test("torn journals and corrupt snapshots rebuild from authoritative files", async () =>
  fixture(async ({ root, options, write }) => {
    const file = await write("00");
    const first = await new MeshInventoryStore(options).initialize();
    await first.begin("01");
    await write("01");
    await fs.unlink(file);
    await fs.appendFile(
      path.join(root, "inventory.journal.ndjson"),
      '{"sequence":',
    );
    const recovered = await new MeshInventoryStore(options).initialize();
    assert.equal(recovered.inventory.has("00"), false);
    assert.equal(recovered.inventory.has_ready("01"), true);
    assert.ok(recovered.inventory.revision >= first.inventory.revision);
    await fs.writeFile(path.join(root, "inventory.json"), "broken snapshot");
    const rebuilt = await new MeshInventoryStore(options).initialize();
    assert.equal(rebuilt.inventory.has_ready("01"), true);
    // A crash between snapshot replacement and journal compaction leaves old events.
    const old = await fs.readFile(path.join(root, "inventory.json"), "utf8");
    const sequence = JSON.parse(old).sequence;
    if (sequence)
      await fs.writeFile(
        path.join(root, "inventory.journal.ndjson"),
        JSON.stringify({ sequence, type: "begin", short_code: "33" }) + "\n",
      );
    const again = await new MeshInventoryStore(options).initialize();
    assert.equal(again.journal.pending.size, 0);
    assert.equal(again.inventory.has_ready("01"), true);
  }));

test("cache hooks publish durable availability and retrieval corrects missing or corrupt observations", async () =>
  fixture(async ({ options }) => {
    const store = await new MeshInventoryStore(options).initialize();
    const plan = {
      bailiwick_id: 55,
      level: 2,
      region: { scope: 1 },
      tiles: [{ short_code: "00" }],
      missing_tiles: [],
    };
    const result = await cache_terrain_plan({
      plan,
      cache_root: options.root,
      mesh_layout: layout,
      source_identity: identity,
      read_tile: async () => source,
      before_write: (code) => store.begin(code),
      after_tile: (code) => store.observe(code, { complete: true }),
    });
    assert.equal(result.created, 1);
    assert.equal(store.inventory.has_ready("00"), true);
    await store.begin("00");
    assert.equal(store.inventory.has_ready("00"), false);
    await store.observe("00", { complete: true });
    assert.equal(store.inventory.has_ready("00"), true);
    const handler = create_mesh_handler({ ...options, inventory_store: store });
    const ok = response();
    await handler({ params: { short_code: "00" } }, ok);
    assert.equal(ok.code, 200);
    const file = path.join(options.root, mesh_relative_path("00", layout));
    await fs.writeFile(file, "broken");
    const bad = response();
    await handler({ params: { short_code: "00" } }, bad);
    assert.equal(bad.code, 503);
    assert.equal(store.inventory.get("00").status, "invalid");
    await fs.unlink(file);
    const missing = response();
    await handler({ params: { short_code: "00" } }, missing);
    assert.equal(missing.code, 404);
    assert.equal(store.inventory.has("00"), false);
    const replay = await new MeshInventoryStore(options).initialize();
    assert.equal(replay.inventory.has("00"), false);
  }));

test("job worker handshakes await inventory durability and job failure recovers pending files", async () => {
  const worker = new EventEmitter(),
    replies = [],
    calls = [];
  worker.postMessage = (message) => replies.push(message);
  worker.terminate = async () => calls.push("terminate");
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const handlers = create_terrain_cache_handlers({
    source_identity: identity,
    inventory_store: {
      begin: async (code) => {
        calls.push(code);
        await gate;
      },
      observe: async (code) => calls.push(`observe ${code}`),
      recover_pending: async () => calls.push("recover"),
    },
    get_record: async () => ({
      id: 55,
      display_settings: { scope: 0.024, focal_point: { x: -0.16, y: 1.035 } },
    }),
    get_codes: () => new Set(["0133230033"]),
    create_worker: () => worker,
  });
  const started = response();
  await handlers.start({ body: { bailiwick_id: 55 } }, started);
  assert.equal(started.code, 202);
  worker.emit("message", {
    inventory_request: { id: 1, action: "begin", short_code: "0133230033" },
  });
  await tick();
  assert.equal(replies.length, 0);
  release();
  await tick();
  assert.equal(replies[0].inventory_response.id, 1);
  worker.emit("message", {
    inventory_request: { id: 2, action: "observe", short_code: "0133230033" },
  });
  await tick();
  assert.equal(replies[1].inventory_response.id, 2);
  worker.emit("error", new Error("worker lost"));
  await tick();
  assert.deepEqual(calls.slice(-2), ["terminate", "recover"]);
  const done = response();
  handlers.status({ params: { id: started.body.job.id } }, done);
  assert.equal(done.body.job.status, "failed");
});
