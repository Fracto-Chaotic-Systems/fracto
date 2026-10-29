import { decode_terrain_bytes } from "./Decode.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { durable_replace } from "./DurableFile.js";
import { gzipSync, gunzipSync } from "node:zlib";
import { build_terrain_tile, TERRAIN_MESH_PROFILE } from "./Mesh.js";
import {
  MESH_DIRECTORY,
  MESH_LAYOUT,
  mesh_relative_path,
  initialize_mesh_storage,
  assert_mesh_capacity,
} from "./Paths.js";

const MAGIC = "FTMESH01";
const TYPES = {
  positions: Float32Array,
  uvs: Float32Array,
  indices: Uint32Array,
  patterns: Int32Array,
  iterations: Float64Array,
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const align = (length) => Math.ceil(length / 8) * 8;
export const terrain_namespace = (source_identity) =>
  hash(
    JSON.stringify({ source_identity, profile: TERRAIN_MESH_PROFILE }),
  ).slice(0, 32);

export function encode_terrain_mesh(mesh, metadata) {
  if (os.endianness() !== "LE")
    throw new Error("Terrain binary encoding requires a little-endian host");
  let byte_length = 0;
  const attributes = {};
  for (const [name, Type] of Object.entries(TYPES)) {
    const array = mesh[name];
    if (!(array instanceof Type))
      throw new Error(`Invalid mesh attribute: ${name}`);
    attributes[name] = {
      offset: byte_length,
      length: array.length,
      bytes: array.byteLength,
    };
    byte_length = align(byte_length + array.byteLength);
  }
  const header = Buffer.from(
    JSON.stringify({
      ...metadata,
      magic: MAGIC,
      profile: TERRAIN_MESH_PROFILE,
      vertex_count: mesh.vertex_count,
      triangle_count: mesh.triangle_count,
      maximum_height: mesh.maximum_height,
      source_sha256: mesh.source_sha256,
      byte_length,
      attributes,
    }),
  );
  const payload_offset = 16 + align(header.length);
  const raw = Buffer.alloc(payload_offset + byte_length);
  raw.write(MAGIC);
  raw.writeUInt32LE(header.length, 8);
  header.copy(raw, 16);
  for (const name of Object.keys(TYPES)) {
    const array = mesh[name];
    Buffer.from(array.buffer, array.byteOffset, array.byteLength).copy(
      raw,
      payload_offset + attributes[name].offset,
    );
  }
  return { compressed: gzipSync(raw, { level: 6 }), raw_bytes: raw.length };
}

export function decode_terrain_mesh(compressed, include_attributes = true) {
  return decode_terrain_bytes(
    gunzipSync(compressed, { maxOutputLength: 16 * 1024 * 1024 }),
    include_attributes,
  );
}

async function atomic_write(filename, contents) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await durable_replace(filename, contents);
}

/** Serial, bounded-memory build. Missing coverage is explicit in the manifest. */
export async function cache_terrain_plan({
  plan,
  cache_root = MESH_DIRECTORY,
  mesh_layout = MESH_LAYOUT,
  source_identity,
  read_tile,
  on_progress = () => {},
  before_write = async () => {},
  after_tile = async () => {},
}) {
  if (
    plan.kind !== "region" &&
    (!Number.isSafeInteger(plan.bailiwick_id) || plan.bailiwick_id <= 0)
  )
    throw new Error("Invalid bailiwick id");
  await initialize_mesh_storage({ root: cache_root, layout: mesh_layout });
  const namespace = terrain_namespace(source_identity);
  const completed = [],
    failed_tiles = [];
  let created = 0,
    reused = 0;
  for (const tile of plan.tiles) {
    const { short_code } = tile;
    if (!/^[0-3]{2,34}$/.test(short_code) || short_code.length !== plan.level)
      throw new Error("Invalid tile short code");
    const relative = mesh_relative_path(short_code, mesh_layout);
    const filename = path.join(cache_root, relative);
    try {
      let decoded, compressed;
      try {
        compressed = await fs.readFile(filename);
        decoded = decode_terrain_mesh(compressed, false);
        if (
          decoded.metadata.short_code !== short_code ||
          decoded.metadata.namespace !== namespace
        )
          throw new Error("Cache identity mismatch");
      } catch {
        decoded = null;
      }
      if (decoded) reused++;
      else {
        const source = await read_tile(short_code);
        if (!source) throw new Error("Source tile unavailable");
        const mesh = build_terrain_tile(source);
        const encoded = encode_terrain_mesh(mesh, {
          short_code,
          namespace,
          bounds: tile.bounds,
          coordinate_system: "tile-local-xz-0-to-1",
          runtime_height_scale: "navigator_scope/25",
        });
        compressed = encoded.compressed;
        decoded = { metadata: mesh, raw_bytes: encoded.raw_bytes };
        await assert_mesh_capacity(cache_root);
        await before_write(short_code);
        await atomic_write(filename, compressed);
        created++;
      }
      completed.push({
        ...tile,
        file: relative,
        bytes: compressed.length,
        raw_bytes: decoded.raw_bytes,
        vertex_count: decoded.metadata.vertex_count,
        triangle_count: decoded.metadata.triangle_count,
        source_sha256: decoded.metadata.source_sha256,
        sha256: hash(compressed),
      });
    } catch (error) {
      if (error.code === "MESH_CAPACITY") throw error;
      failed_tiles.push({ short_code, reason: "mesh_build_failed" });
      on_progress({ warning: error.message, short_code });
    }
    await after_tile(short_code);
    on_progress({
      processed: completed.length + failed_tiles.length,
      total: plan.tiles.length,
      created,
      reused,
      failed: failed_tiles.length,
      short_code,
      mesh_ready: completed.at(-1)?.short_code === short_code,
    });
  }
  const status =
    completed.length === 0
      ? "failed"
      : failed_tiles.length || plan.missing_tiles.length
        ? "partial"
        : "completed";
  const manifest_name =
    plan.kind === "region"
      ? `region-level-${plan.level}`
      : `free-bailiwick-${plan.bailiwick_id}`;
  const manifest_relative = `manifests/${namespace}/${manifest_name}-${hash(JSON.stringify(plan.region)).slice(0, 16)}.json`;
  const manifest = {
    ...plan,
    source_identity,
    namespace,
    mesh_layout,
    profile: TERRAIN_MESH_PROFILE,
    created_at: new Date().toISOString(),
    status,
    tiles: completed,
    failed_tiles,
    summary: {
      created,
      reused,
      failed: failed_tiles.length,
      missing: plan.missing_tiles.length,
      tile_count: completed.length,
      compressed_bytes: completed.reduce((sum, tile) => sum + tile.bytes, 0),
      raw_bytes: completed.reduce((sum, tile) => sum + tile.raw_bytes, 0),
    },
  };
  await atomic_write(
    path.join(cache_root, manifest_relative),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return {
    status,
    manifest: manifest_relative,
    namespace,
    level: plan.level,
    native_resolution: plan.native_resolution,
    ...manifest.summary,
  };
}
