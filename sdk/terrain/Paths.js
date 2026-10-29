import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  TILE_DATA_DIRECTORY,
  TILE_SOURCE_DIRECTORY,
  TILE_SOURCE_MODE,
} from "../FractoTilePaths.js";

export const MESH_TILE_DIRECTORY =
  TILE_SOURCE_MODE === "local" ? TILE_SOURCE_DIRECTORY : TILE_DATA_DIRECTORY;
export const MESH_DIRECTORY = path.join(MESH_TILE_DIRECTORY, "meshes");
export const MESH_LAYOUT = TILE_SOURCE_MODE === "local" ? "level" : "shortcode";

export function mesh_relative_path(short_code, layout = MESH_LAYOUT) {
  if (typeof short_code !== "string" || !/^[0-3]{2,34}$/.test(short_code))
    throw new Error("Invalid mesh short code");
  if (layout === "level")
    return `L${String(short_code.length).padStart(2, "0")}/${short_code}.gz`;
  if (layout !== "shortcode") throw new Error("Invalid mesh storage layout");
  const pieces = short_code.match(/.{4}/g) || [];
  return [...pieces, `${short_code}.gz`].join("/");
}

/** Creates only the mesh subtree; verifies that atomic writes and reads work. */
export async function initialize_mesh_storage({
  root = MESH_DIRECTORY,
  layout = MESH_LAYOUT,
} = {}) {
  // Validate layout even on an empty store.
  mesh_relative_path("00", layout);
  root = path.resolve(root);
  await fs.mkdir(root, { recursive: true });
  const marker = path.join(root, ".fracto-mesh-store.json");
  const expected = { schema_version: 1, layout, encoding: "FTMESH01+gzip" };
  try {
    const stored = JSON.parse(await fs.readFile(marker, "utf8"));
    if (JSON.stringify(stored) !== JSON.stringify(expected))
      throw new Error(
        "Mesh store metadata does not match the configured layout",
      );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const temporary = `${marker}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(expected) + "\n", {
        flag: "wx",
      });
      await fs.rename(temporary, marker);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  const probe = path.join(root, `.probe-${randomUUID()}`);
  try {
    await fs.writeFile(probe, "mesh-store-ready", { flag: "wx" });
    await fs.rename(probe, `${probe}.ready`);
    if ((await fs.readFile(`${probe}.ready`, "utf8")) !== "mesh-store-ready")
      throw new Error("Mesh store read-back failed");
  } finally {
    await fs.rm(probe, { force: true });
    await fs.rm(`${probe}.ready`, { force: true });
  }
  return { root, layout, ...expected };
}

export async function assert_mesh_capacity(root = MESH_DIRECTORY) {
  const minimum = Number(process.env.FRACTO_TILE_MIN_FREE_BYTES || 1024 ** 3);
  if (!Number.isFinite(minimum) || minimum < 0)
    throw new Error("FRACTO_TILE_MIN_FREE_BYTES must be non-negative");
  const stats = await fs.statfs(root);
  if (stats.bavail * stats.bsize < minimum)
    throw Object.assign(
      new Error("Insufficient free space on the tile/mesh volume"),
      { code: "MESH_CAPACITY" },
    );
}
