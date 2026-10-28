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
} from "../sdk/terrain/Paths.js";
import { read_mesh_file } from "../sdk/terrain/Storage.js";
import { build_terrain_tile } from "../sdk/terrain/Mesh.js";
import {
  encode_terrain_mesh,
  terrain_namespace,
} from "../sdk/terrain/Cache.js";
import { create_mesh_handler } from "../servers/fracto-tiles-server/terrain/Access.js";

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

test("mesh paths mirror level and four-character tile layouts and reject traversal", () => {
  assert.equal(mesh_relative_path("01", "shortcode"), "01.gz");
  assert.equal(mesh_relative_path("0123", "shortcode"), "0123/0123.gz");
  assert.equal(
    mesh_relative_path("0123012301", "shortcode"),
    "0123/0123/0123012301.gz",
  );
  assert.equal(mesh_relative_path("0123012301", "level"), "L10/0123012301.gz");
  for (const code of [
    "../01",
    "01/23",
    "01\\23",
    "04",
    "",
    "0",
    "0".repeat(35),
  ])
    assert.throws(() => mesh_relative_path(code));
  assert.throws(() => mesh_relative_path("01", "invalid"));
});

test("default mesh root is on the active tile volume, without import-time writes", async () =>
  with_store(async (directory) => {
    for (const mode of ["remote-cache", "local"]) {
      const tiles = path.join(directory, mode);
      const script =
        "import {MESH_DIRECTORY,MESH_LAYOUT} from './sdk/terrain/Paths.js'; console.log(JSON.stringify([MESH_DIRECTORY,MESH_LAYOUT]));";
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

test("initialization is idempotent, preserves numerical tiles, and fails on incompatible storage", async () =>
  with_store(async (directory) => {
    const tile = path.join(directory, "01.gz");
    await fs.writeFile(tile, "numerical tile");
    const root = path.join(directory, "meshes");
    const options = { root, layout: "shortcode" };
    assert.deepEqual(
      await initialize_mesh_storage(options),
      await initialize_mesh_storage(options),
    );
    assert.equal(await fs.readFile(tile, "utf8"), "numerical tile");
    assert.deepEqual(await fs.readdir(root), [".fracto-mesh-store.json"]);
    await assert.rejects(
      initialize_mesh_storage({ root, layout: "level" }),
      /does not match/,
    );
    await assert.rejects(
      initialize_mesh_storage({ root: tile }),
      /EEXIST|ENOTDIR/,
    );
  }));

test("stored gzip meshes can be loaded into typed arrays and retrieved without generation", async () =>
  with_store(async (directory) => {
    const root = path.join(directory, "meshes"),
      layout = "level",
      short_code = "012301";
    await initialize_mesh_storage({ root, layout });
    const source = Array.from({ length: 256 }, () =>
      Array.from({ length: 256 }, () => [2, 42]),
    );
    const mesh = build_terrain_tile(source);
    const { compressed } = encode_terrain_mesh(mesh, {
      short_code,
      namespace: terrain_namespace(identity),
      bounds: { left: 0, right: 1, top: 1, bottom: 0 },
      coordinate_system: "tile-local-xz-0-to-1",
      runtime_height_scale: "navigator_scope/25",
    });
    const file = path.join(root, mesh_relative_path(short_code, layout));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, compressed);
    const loaded = await read_mesh_file(short_code, {
      root,
      layout,
      source_identity: identity,
    });
    assert.deepEqual(loaded.positions, mesh.positions);
    assert.deepEqual(loaded.indices, mesh.indices);
    assert.deepEqual(loaded.uvs, mesh.uvs);
    assert.deepEqual(loaded.patterns, mesh.patterns);
    assert.deepEqual(loaded.iterations, mesh.iterations);
    const handler = create_mesh_handler({
      root,
      layout,
      source_identity: identity,
    });
    const res = response();
    await handler({ params: { short_code } }, res);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, compressed);
    assert.equal(res.headers["Content-Type"], "application/gzip");
    assert.equal(res.headers["Content-Encoding"], undefined);
    assert.ok(res.headers.ETag);
    const missing = response();
    await handler({ params: { short_code: "33" } }, missing);
    assert.equal(missing.code, 404);
    const invalid = response();
    await handler({ params: { short_code: "../secret" } }, invalid);
    assert.equal(invalid.code, 400);
    const stale = response();
    await create_mesh_handler({
      root,
      layout,
      source_identity: { generation: "other" },
    })({ params: { short_code } }, stale);
    assert.equal(stale.code, 409);
    const raw = gunzipSync(compressed);
    const header_length = raw.readUInt32LE(8);
    const header = JSON.parse(raw.toString("utf8", 16, 16 + header_length));
    header.profile.version = 9;
    const changed_header = Buffer.from(JSON.stringify(header));
    assert.equal(changed_header.length, header_length);
    changed_header.copy(raw, 16);
    await fs.writeFile(file, gzipSync(raw));
    const incompatible = response();
    await handler({ params: { short_code } }, incompatible);
    assert.equal(incompatible.code, 409);
    await fs.writeFile(file, "corrupt");
    const corrupt = response();
    await handler({ params: { short_code } }, corrupt);
    assert.equal(corrupt.code, 503);
    assert.equal(JSON.stringify(corrupt.body).includes(directory), false);
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
      "import {initialize_mesh_storage,assert_mesh_capacity} from './sdk/terrain/Paths.js'",
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
