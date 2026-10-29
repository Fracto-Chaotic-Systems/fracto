import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import express from "express";
import { MeshInventoryStore } from "../sdk/terrain/InventoryStore.js";
import { mesh_relative_path } from "../sdk/terrain/Paths.js";
import { build_terrain_tile } from "../sdk/terrain/Mesh.js";
import {
  encode_terrain_mesh,
  terrain_namespace,
} from "../sdk/terrain/Cache.js";
import { create_mesh_handler } from "../servers/fracto-tiles-server/terrain/Access.js";
import { create_mesh_heat_map_handler } from "../servers/fracto-tiles-server/terrain/HeatMap.js";

export const identity = { generation: "mesh-lifecycle-test" };
export const source = Array.from({ length: 256 }, () =>
  Array.from({ length: 256 }, () => [2, 42]),
);
const geometry = build_terrain_tile(source);

export async function lifecycle_fixture(layout, run) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "fracto-mesh-lifecycle-"),
  );
  const options = {
    root: path.join(directory, "meshes"),
    layout,
    source_identity: identity,
  };
  const filename = (code) =>
    path.join(options.root, mesh_relative_path(code, layout));
  const write = async (code, source_identity = identity) => {
    const encoded = encode_terrain_mesh(geometry, {
      short_code: code,
      namespace: terrain_namespace(source_identity),
    });
    await fs.mkdir(path.dirname(filename(code)), { recursive: true });
    await fs.writeFile(filename(code), encoded.compressed);
  };
  try {
    await run({ directory, options, filename, write });
  } finally {
    assert.ok(
      path
        .resolve(directory)
        .startsWith(path.join(os.tmpdir(), "fracto-mesh-lifecycle-")),
    );
    await fs.rm(directory, { recursive: true, force: true });
  }
}

/** Real handlers and HTTP serialization on loopback, with an isolated store. */
export async function serve_inventory(store, options, run) {
  const app = express();
  app.get(
    "/mesh_heat_map_buffer",
    create_mesh_heat_map_handler(store.inventory),
  );
  app.get("/mesh_inventory", (_req, res) =>
    res.json(store.inventory.summary()),
  );
  app.get(
    "/meshes/:short_code",
    create_mesh_handler({ ...options, inventory_store: store }),
  );
  app.post("/mesh_inventory/reconcile", async (_req, res) => {
    try {
      res.json(await store.reconcile({ force: true }));
    } catch {
      res.status(503).json({ error: "Reconciliation failed" });
    }
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (url, init) =>
    fetch(origin + url, { ...init, signal: AbortSignal.timeout(10000) });
  try {
    await run(request);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

export const heat_query = (changes = {}) =>
  "/mesh_heat_map_buffer?" +
  new URLSearchParams({
    width_px: 16,
    focal_point_x: -1.5,
    focal_point_y: 1.5,
    scope: 1,
    ...changes,
  });
export const map_result = async (request, changes) => {
  const response = await request(heat_query(changes));
  assert.equal(response.status, 200);
  return response.json();
};

/** Abruptly kill a separate owner after a durable intent, optionally after publication. */
export async function crash_owner(options, { code, publish, fixture_file }) {
  const store_module = new URL(
    "../sdk/terrain/InventoryStore.js",
    import.meta.url,
  ).href;
  const paths_module = new URL("../sdk/terrain/Paths.js", import.meta.url).href;
  const durable_module = new URL(
    "../sdk/terrain/DurableFile.js",
    import.meta.url,
  ).href;
  const script = `
    import fs from 'node:fs/promises'; import path from 'node:path';
    import {MeshInventoryStore} from ${JSON.stringify(store_module)};
    import {mesh_relative_path} from ${JSON.stringify(paths_module)};
    import {durable_replace} from ${JSON.stringify(durable_module)};
    const options=JSON.parse(process.env.FRACTO_TEST_MESH_STORE);
    const store=await new MeshInventoryStore(options).initialize();
    const code=process.env.FRACTO_TEST_MESH_CODE;
    await store.begin(code);
    if(process.env.FRACTO_TEST_MESH_PUBLISH==='true') {
      const target=path.join(options.root,mesh_relative_path(code,options.layout));
      await fs.mkdir(path.dirname(target),{recursive:true});
      await durable_replace(target,await fs.readFile(process.env.FRACTO_TEST_MESH_FIXTURE));
    }
    process.send({ready:true}); setInterval(()=>{},1000);
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    env: {
      ...process.env,
      FRACTO_TEST_MESH_STORE: JSON.stringify(options),
      FRACTO_TEST_MESH_CODE: code,
      FRACTO_TEST_MESH_PUBLISH: String(publish),
      FRACTO_TEST_MESH_FIXTURE: fixture_file || "",
    },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "",
    timer;
  child.stderr.on("data", (data) => {
    stderr = (stderr + data).slice(-2000);
  });
  const exited = once(child, "exit");
  try {
    await Promise.race([
      once(child, "message"),
      exited.then(() => {
        throw new Error(`Crash fixture exited early: ${stderr}`);
      }),
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Crash fixture timed out")),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await exited;
  }
}

export const reopen_inventory = (options) =>
  new MeshInventoryStore(options).initialize();
