import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { once } from "node:events";
import { MeshInventoryStore } from "../sdk/terrain/InventoryStore.js";
import { mesh_relative_path } from "../sdk/terrain/Paths.js";
import { build_terrain_tile } from "../sdk/terrain/Mesh.js";
import {
  encode_terrain_mesh,
  terrain_namespace,
} from "../sdk/terrain/Cache.js";
import { read_mesh_file } from "../sdk/terrain/Storage.js";
import {
  MeshFileSync,
  create_mesh_file_sync_router,
} from "../servers/fracto-tiles-server/terrain/Sync.js";
import { create_mesh_job_queue } from "../servers/fracto-tiles-server/terrain/Queue.js";
import {
  MeshSyncJobs,
  create_mesh_peer_router,
  peer_mesh_request,
  plan_mesh_sync,
} from "../servers/fracto-admin-server/handlers/mesh_sync.js";
import {
  require_internal_service,
  internal_service_headers,
} from "../utils/service_authorization.js";
import { acquire_mesh_session } from "../servers/fracto-admin-server/handlers/mesh_sync_session.js";

test("inventory acquisition polls past the old four-minute request deadline and reports scan progress", async () => {
  let time = 0,
    polls = 0;
  const progress = [];
  const result = await acquire_mesh_session(
    async (route) => {
      if (route === "/sessions/start")
        return { id: "scan", status: "checking" };
      assert.equal(route, "/sessions/scan/status");
      return ++polls < 3
        ? { status: "checking", files_checked: polls * 64 }
        : { status: "ready", catalog: { version: 1 } };
    },
    (state) => progress.push(state.files_checked),
    {
      now: () => time,
      sleep: async () => {
        time += 240001;
      },
    },
  );
  assert.equal(time, 480002);
  assert.deepEqual(progress, [64, 128, 0]);
  assert.equal(result.catalog.version, 1);
});

test("failed acquisitions close their reservation and old peers fall back only when start is absent", async () => {
  const calls = [];
  await assert.rejects(
    acquire_mesh_session(async (route) => {
      calls.push(route);
      if (route === "/sessions/start") return { id: "scan" };
      if (route.endsWith("/status"))
        return { status: "failed", error: "mesh_sync_storage_failed" };
      return { closed: true };
    }),
    /mesh_sync_storage_failed/,
  );
  assert.equal(calls.at(-1), "/sessions/scan/close");
  const legacy = await acquire_mesh_session(async (route) => {
    if (route === "/sessions/start")
      throw Object.assign(Error("missing"), { status: 404 });
    assert.equal(route, "/sessions");
    return { id: "legacy", catalog: { version: 1 } };
  });
  assert.equal(legacy.id, "legacy");
  const origin_fallback = await acquire_mesh_session(async (route) => {
    if (route === "/sessions/start")
      throw Object.assign(Error("unknown route reached browser origin guard"), {
        status: 403,
        code: "Untrusted request origin",
      });
    assert.equal(route, "/sessions");
    return { id: "legacy-origin", catalog: { version: 1 } };
  });
  assert.equal(origin_fallback.id, "legacy-origin");
  let denied_calls = 0;
  await assert.rejects(
    acquire_mesh_session(async () => {
      denied_calls++;
      throw Object.assign(Error("sync_peer_unauthorized"), {
        status: 403,
        code: "sync_peer_unauthorized",
      });
    }),
    /sync_peer_unauthorized/,
  );
  assert.equal(
    denied_calls,
    1,
    "authentication failures never trigger a legacy retry",
  );
});

test("a scanning store reports progress and releases an abandoned reservation when its scan finishes", async () => {
  let finish, notify;
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  const store = {
    journal: { pending: new Set() },
    inventory: { namespace: "0".repeat(32), snapshot: () => ({ records: [] }) },
    reconcile: async ({ on_progress }) => {
      notify = on_progress;
      await gate;
    },
  };
  const sync = new MeshFileSync({ inventory_store: store });
  const opened = sync.start();
  const completion = sync.sessions.get(opened.id).completion;
  notify({ files_checked: 64 });
  assert.equal(sync.status(opened.id).files_checked, 64);
  assert.equal(sync.status(opened.id).status, "checking");
  assert.throws(() => sync.start(), /mesh_jobs_active/);
  sync.close(opened.id);
  assert.ok(
    store.sync_owner,
    "scan owns the store until its outstanding reads finish",
  );
  finish();
  await completion;
  assert.equal(store.sync_owner, null);
});

test("incompatible mesh identities fail before scanning the local volume and release the remote reservation", async () => {
  const local_calls = [],
    remote_calls = [];
  const jobs = new MeshSyncJobs({
    peers: () => new Map([["http://lab.example", {}]]),
    local: async (route) => {
      local_calls.push(route);
      assert.equal(route, "/identity");
      return { version: 1, namespace: "a".repeat(32), profile: { version: 1 } };
    },
    remote: async (_peer, route) => {
      remote_calls.push(route);
      return route === "/sessions"
        ? {
            id: "remote",
            catalog: {
              version: 1,
              namespace: "b".repeat(32),
              profile: { version: 1 },
              records: [],
            },
          }
        : { closed: true };
    },
  });
  const job = jobs.create("http://lab.example");
  await jobs.jobs.get(job.id).completion;
  assert.equal(jobs.get(job.id).error, "mesh_source_mismatch");
  assert.deepEqual(local_calls, ["/identity"]);
  assert.equal(remote_calls.at(-1), "/sessions/remote/close");
});

const identity = { generation: "mesh-sync-fixture" };
const geometry = build_terrain_tile(
  Array.from({ length: 256 }, () => Array.from({ length: 256 }, () => [2, 42])),
);
const encoded = (code, variant = "same") =>
  encode_terrain_mesh(geometry, {
    short_code: code,
    namespace: terrain_namespace(identity),
    variant,
  }).compressed;
const start = async (app) => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, url: `http://127.0.0.1:${server.address().port}` };
};

test("mesh planning supports catalogs at the live store's 131088-file scale", () => {
  const records = Array.from({ length: 131088 }, (_, i) => ({
    short_code: i.toString(4).padStart(10, "0"),
    sha256: "a".repeat(64),
    bytes: 4096,
    status: "ready",
  }));
  const base = {
    version: 1,
    namespace: terrain_namespace(identity),
    profile: { version: 1 },
  };
  const a = { ...base, records },
    b = { ...base, records: records.slice(65544) };
  assert.ok(Buffer.byteLength(JSON.stringify(a)) < 64 * 1024 * 1024);
  const plan = plan_mesh_sync(a, b);
  assert.equal(plan.records.length, 131088);
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.transfers.length, 65544);
  assert.equal(plan.tables[0].merged_rows, 131088);
  const conflicting = plan_mesh_sync(a, {
    ...base,
    records: records.map((r) => ({ ...r, sha256: "b".repeat(64) })),
  });
  assert.equal(conflicting.conflict_count, 131088);
  assert.equal(
    conflicting.conflicts.length,
    200,
    "conflict samples stay bounded for the browser",
  );
});

test("mesh sync shares real files through authenticated HTTP, repairs invalid meshes, handles conflicts and interrupted transfers, and leaves tiles local", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "fracto-mesh-sync-"),
  );
  const old_token = process.env.FRACTO_INTERNAL_SERVICE_TOKEN;
  process.env.FRACTO_INTERNAL_SERVICE_TOKEN = "private-local-mesh-test-token";
  const servers = [];
  const make = async (name, layout) => {
    const root = path.join(directory, name, "meshes");
    const store = await new MeshInventoryStore({
      root,
      layout,
      source_identity: identity,
    }).initialize();
    await fs.writeFile(
      path.join(directory, name, "tile-sentinel.gz"),
      `tile-${name}`,
    );
    const write = async (code, variant) => {
      const filename = path.join(root, mesh_relative_path(code, layout));
      await fs.mkdir(path.dirname(filename), { recursive: true });
      await fs.writeFile(filename, encoded(code, variant));
      return filename;
    };
    const app = express();
    app.use(
      "/internal/mesh-sync",
      require_internal_service,
      create_mesh_file_sync_router({
        inventory_store: store,
        capacity: async () => {},
      }),
    );
    const endpoint = await start(app);
    servers.push(endpoint.server);
    const local = async (route, body = {}) => {
      const res = await fetch(endpoint.url + "/internal/mesh-sync" + route, {
        method: "POST",
        headers: internal_service_headers({
          "content-type": "application/json",
        }),
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok)
        throw Object.assign(new Error(result.error), {
          status: res.status,
          code: result.error,
        });
      return result;
    };
    return { store, root, write, local, endpoint };
  };
  try {
    const a = await make("a", "level"),
      b = await make("b", "shortcode");
    for (const code of ["00", "01", "02"])
      await a.write(code, code === "02" ? "local" : "same");
    for (const code of ["10", "01", "02", "03"])
      await b.write(code, code === "02" ? "remote" : "same");
    const invalid = path.join(a.root, mesh_relative_path("03", "level"));
    await fs.writeFile(invalid, "corrupt mesh");
    const token = "pair-specific-mesh-sync-token-32-characters";
    const peer_app = express();
    peer_app.use(
      "/mesh-sync/peer",
      create_mesh_peer_router({
        local: b.local,
        peers: () => new Map([["local", { token }]]),
      }),
    );
    const peer_endpoint = await start(peer_app);
    servers.push(peer_endpoint.server);
    const peer = { endpoint: peer_endpoint.url, token };
    const peers = () => new Map([["http://lab.example", peer]]);
    const denied = await fetch(peer.endpoint + "/mesh-sync/peer/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "invalid json",
    });
    assert.equal(denied.status, 403);
    assert.equal(
      (
        await fetch(a.endpoint.url + "/internal/mesh-sync/sessions", {
          method: "POST",
        })
      ).status,
      403,
    );
    const jobs = new MeshSyncJobs({ local: a.local, peers });
    let job = jobs.create("http://lab.example/");
    await jobs.jobs.get(job.id).completion;
    assert.equal(
      jobs.get(job.id).status,
      "ready",
      JSON.stringify(jobs.get(job.id)),
    );
    assert.equal(jobs.get(job.id).conflicts.length, 1);
    assert.equal(jobs.get(job.id).skipped, 1);
    assert.ok(!JSON.stringify(jobs.get(job.id)).includes(token));
    assert.throws(() => jobs.apply(job.id), /choose_conflict_server/);
    assert.ok(!a.store.sync_owner && !b.store.sync_owner);
    jobs.apply(job.id, "remote");
    await jobs.jobs.get(job.id).completion;
    assert.equal(
      jobs.get(job.id).status,
      "completed",
      JSON.stringify(jobs.get(job.id)),
    );
    assert.equal(jobs.get(job.id).progress.files_processed, 4);
    for (const item of [a, b]) {
      for (const code of ["00", "01", "02", "03", "10"])
        assert.equal(item.store.inventory.has_ready(code), true);
      const conflict = await read_mesh_file("02", {
        root: item.root,
        layout: item.store.layout,
        source_identity: identity,
        include_attributes: false,
      });
      assert.equal(conflict.metadata.variant, "remote");
    }
    assert.equal(
      await fs.readFile(path.join(directory, "a", "tile-sentinel.gz"), "utf8"),
      "tile-a",
    );
    assert.equal(
      await fs.readFile(path.join(directory, "b", "tile-sentinel.gz"), "utf8"),
      "tile-b",
    );
    assert.notEqual(a.store.inventory.epoch, b.store.inventory.epoch);

    job = jobs.create("http://lab.example");
    await jobs.jobs.get(job.id).completion;
    await a.write("11");
    jobs.apply(job.id);
    await jobs.jobs.get(job.id).completion;
    assert.equal(jobs.get(job.id).error, "mesh_snapshot_changed");
    await b.write("12");
    const interrupted = new MeshSyncJobs({
      local: a.local,
      peers,
      remote: async (...args) => {
        const result = await peer_mesh_request(...args);
        if (args[1].includes("/write/"))
          throw Error("lost transfer acknowledgement");
        return result;
      },
    });
    job = interrupted.create("http://lab.example");
    await interrupted.jobs.get(job.id).completion;
    interrupted.apply(job.id);
    await interrupted.jobs.get(job.id).completion;
    assert.equal(interrupted.get(job.id).status, "partial");
    assert.equal(b.store.inventory.has_ready("11"), true);
    job = jobs.create("http://lab.example");
    await jobs.jobs.get(job.id).completion;
    assert.equal(
      jobs.get(job.id).progress.files_total,
      1,
      "previously published meshes are skipped on retry",
    );
    jobs.apply(job.id);
    await jobs.jobs.get(job.id).completion;
    assert.equal(jobs.get(job.id).status, "completed");
    assert.equal(a.store.inventory.has_ready("12"), true);

    const lock = new MeshFileSync({ inventory_store: a.store });
    const opened = await lock.open();
    const queue = create_mesh_job_queue({ inventory_store: a.store });
    assert.throws(() => queue.enqueue({}), /synchronization is in progress/);
    await assert.rejects(lock.open(), /mesh_jobs_active/);
    lock.close(opened.id);
    const active = new MeshFileSync({
      inventory_store: a.store,
      has_active_jobs: () => true,
    });
    await assert.rejects(active.open(), /mesh_jobs_active/);
    const other = structuredClone(opened.catalog);
    other.namespace = "0".repeat(32);
    assert.throws(
      () => plan_mesh_sync(opened.catalog, other),
      /mesh_source_mismatch/,
    );
  } finally {
    for (const server of servers)
      await new Promise((resolve) => server.close(resolve));
    if (old_token === undefined)
      delete process.env.FRACTO_INTERNAL_SERVICE_TOKEN;
    else process.env.FRACTO_INTERNAL_SERVICE_TOKEN = old_token;
    assert.ok(
      path
        .resolve(directory)
        .startsWith(path.join(os.tmpdir(), "fracto-mesh-sync-")),
    );
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("mesh imports reject checksum failures, symlink escapes, and abandoned store reservations", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "fracto-mesh-sync-security-"),
  );
  let sync, opened;
  try {
    const root = path.join(directory, "meshes"),
      outside = path.join(directory, "outside");
    const store = await new MeshInventoryStore({
      root,
      layout: "shortcode",
      source_identity: identity,
    }).initialize();
    sync = new MeshFileSync({
      inventory_store: store,
      capacity: async () => {},
    });
    opened = await sync.open();
    const data = encoded("000000");
    const { createHash } = await import("node:crypto");
    const record = {
      sha256: createHash("sha256").update(data).digest("hex"),
      bytes: data.length,
    };
    await assert.rejects(
      sync.with_session(opened.id, () =>
        sync.write("000000", {
          data: data.toString("base64"),
          record: { ...record, sha256: "0".repeat(64) },
          expected: null,
        }),
      ),
      /mesh_checksum_mismatch/,
    );
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "000000.gz"), "keep");
    await fs.symlink(outside, path.join(root, "0000"), "dir");
    await assert.rejects(
      sync.with_session(opened.id, () =>
        sync.write("000000", {
          data: data.toString("base64"),
          record,
          expected: null,
        }),
      ),
      /unsafe_mesh_path/,
    );
    assert.equal(
      await fs.readFile(path.join(outside, "000000.gz"), "utf8"),
      "keep",
    );
    sync.close(opened.id);
    const expiring = new MeshFileSync({ inventory_store: store, ttl_ms: 20 });
    await expiring.open();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(store.sync_owner, null);
  } finally {
    if (opened) sync.close(opened.id);
    assert.ok(
      path
        .resolve(directory)
        .startsWith(path.join(os.tmpdir(), "fracto-mesh-sync-security-")),
    );
    await fs.rm(directory, { recursive: true, force: true });
  }
});
