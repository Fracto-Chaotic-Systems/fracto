import fs from "node:fs/promises";
import path from "node:path";
import { decode_terrain_mesh, terrain_namespace } from "./Cache.js";
import { MESH_DIRECTORY, MESH_LAYOUT, mesh_relative_path } from "./Paths.js";

/** Return the original gzip bytes, validating format and source before use. */
export async function read_mesh_file(
  short_code,
  {
    root = MESH_DIRECTORY,
    layout = MESH_LAYOUT,
    source_identity,
    include_attributes = true,
  } = {},
) {
  const relative = mesh_relative_path(short_code, layout);
  const compressed = await fs.readFile(path.join(root, relative));
  const decoded = decode_terrain_mesh(compressed, include_attributes);
  if (
    decoded.metadata.short_code !== short_code ||
    (source_identity &&
      decoded.metadata.namespace !== terrain_namespace(source_identity))
  ) {
    const error = new Error("Mesh source identity does not match");
    error.code = "MESH_STALE";
    throw error;
  }
  return { ...decoded, compressed, relative };
}
