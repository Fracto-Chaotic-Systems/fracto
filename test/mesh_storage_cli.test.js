import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  initialize_mesh_storage,
  mesh_relative_path,
} from "@fracto/sdk/terrain/Paths.js";
import { read_mesh_file } from "@fracto/sdk/terrain/Storage.js";
import { build_terrain_tile } from "@fracto/sdk/terrain/Mesh.js";
import {
  encode_terrain_mesh,
  terrain_namespace,
} from "@fracto/sdk/terrain/Cache.js";

const identity = { generation: "mesh-test" };
const with_store = async (run) => {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "fracto-mesh-storage-"),
  );
  try {
    await run(temporary);
  } finally {
    assert.ok(
      path
        .resolve(temporary)
        .startsWith(path.join(os.tmpdir(), "fracto-mesh-storage-")),
    );
    await fs.rm(temporary, { recursive: true, force: true });
  }
};
const response = () => ({
  code: 200,
  headers: {},
  status(code) {
    this.code = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
  setHeader(key, value) {
    this.headers[key] = value;
  },
  send(body) {
    this.body = body;
    return this;
  },
});


test("default mesh root is on the active tile volume, without import-time writes", async () =>
  with_store(async (directory) => {
    for (const mode of ["remote-cache", "local"]) {
      const tiles = path.join(directory, mode);
      const script =
        "import {MESH_DIRECTORY,MESH_LAYOUT} from '@fracto/sdk/terrain/Paths.js'; console.log(JSON.stringify([MESH_DIRECTORY,MESH_LAYOUT]));";
      const result = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", script],
        {
          cwd: path.resolve(import.meta.dirname, ".."),
          encoding: "utf8",
          env: {
            ...process.env,
            FRACTO_TILE_SOURCE_MODE: mode,
            FRACTO_TILE_DATA_DIR: tiles,
            FRACTO_TILE_SOURCE_DIR: tiles,
            FRACTO_TILE_SOURCE_GENERATION: "test",
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), [
        path.join(tiles, "meshes"),
        mode === "local" ? "level" : "shortcode",
      ]);
      await assert.rejects(fs.stat(tiles), { code: "ENOENT" });
    }
  }));
test("initialization CLI prepares the local source meshes subtree", async () =>
  with_store(async (directory) => {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/initialize_mesh_storage.js",
        "--tiles-directory",
        directory,
        "--layout",
        "level",
      ],
      {
        cwd: path.resolve(import.meta.dirname, ".."),
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const ready = JSON.parse(result.stdout);
    assert.equal(ready.root, path.join(directory, "meshes"));
    assert.equal(ready.layout, "level");
    assert.equal(
      JSON.parse(
        await fs.readFile(path.join(ready.root, ".fracto-mesh-store.json")),
      ).encoding,
      "FTMESH01+gzip",
    );
  }));
test("Docker keeps numerical local sources read-only and places writable meshes on their source volume", async () => {
  const local = await fs.readFile(
    new URL("../compose.local-tiles.yaml", import.meta.url),
    "utf8",
  );
  assert.match(local, /target: \/mnt\/fracto-tile-source\s+read_only: true/);
  assert.match(
    local,
    /source: .*\/meshes\s+target: \/mnt\/fracto-tile-source\/meshes\s+read_only: false\s+bind:\s+create_host_path: false/,
  );
  const dev = await fs.readFile(
    new URL("../compose.dev.yaml", import.meta.url),
    "utf8",
  );
  assert.match(dev, /FRACTO_TILE_CACHE_READ_ONLY: "true"/);
  assert.match(dev, /- fracto-tile-data:\/var\/lib\/fracto\/tiles\s/);
});
test("initialization rejects denied writes and mesh capacity enforces the volume reserve", async () =>
  with_store(async (directory) => {
    const script = [
      "import fs from 'node:fs/promises'",
      "import {initialize_mesh_storage,assert_mesh_capacity} from '@fracto/sdk/terrain/Paths.js'",
      "const root=process.env.TEST_MESH_ROOT",
      "await initialize_mesh_storage({root})",
      "const write=fs.writeFile",
      "fs.writeFile=async (...args)=>{if(String(args[0]).includes('.probe-'))throw Object.assign(new Error('write denied'),{code:'EACCES'});return write(...args)}",
      "let denied=false;try{await initialize_mesh_storage({root})}catch(e){denied=e.code==='EACCES'}",
      "if(!denied)throw new Error('Denied writes were accepted')",
      "process.env.FRACTO_TILE_MIN_FREE_BYTES=String(Number.MAX_SAFE_INTEGER)",
      "let full=false;try{await assert_mesh_capacity(root)}catch(e){full=/Insufficient free space/.test(e.message)}",
      "if(!full)throw new Error('Volume reserve was ignored')",
    ].join(";");
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        cwd: path.resolve(import.meta.dirname, ".."),
        encoding: "utf8",
        env: { ...process.env, TEST_MESH_ROOT: path.join(directory, "meshes") },
      },
    );
    assert.equal(result.status, 0, result.stderr);
  }));