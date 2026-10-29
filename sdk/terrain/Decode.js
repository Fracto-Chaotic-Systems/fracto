import { TERRAIN_MESH_PROFILE } from "./Profile.js";
const MAGIC = "FTMESH01";
const TYPES = {
  positions: Float32Array,
  uvs: Float32Array,
  indices: Uint32Array,
  patterns: Int32Array,
  iterations: Float64Array,
};
const align = (length) => Math.ceil(length / 8) * 8;
/** Decode decompressed FTMESH01 bytes in Node or the browser. */
export function decode_terrain_bytes(raw, include_attributes = true) {
  if (!(raw instanceof Uint8Array)) throw new Error("Invalid mesh bytes");
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (raw.length < 16 || new TextDecoder().decode(raw.subarray(0, 8)) !== MAGIC)
    throw new Error("Invalid terrain mesh magic");
  const header_length = view.getUint32(8, true),
    start = 16 + align(header_length);
  if (header_length < 2 || start > raw.length)
    throw new Error("Invalid terrain mesh header");
  const metadata = JSON.parse(
    new TextDecoder().decode(raw.subarray(16, 16 + header_length)),
  );
  if (metadata.magic !== MAGIC || metadata.byte_length !== raw.length - start)
    throw new Error("Invalid terrain mesh profile or size");
  if (
    JSON.stringify(metadata.profile) !== JSON.stringify(TERRAIN_MESH_PROFILE)
  ) {
    const error = new Error("Mesh build profile requires rebuilding");
    error.code = "MESH_STALE";
    throw error;
  }
  const result = { metadata, raw_bytes: raw.length };
  let end = 0;
  for (const [name, Type] of Object.entries(TYPES)) {
    const attr = metadata.attributes?.[name];
    if (
      !attr ||
      !Number.isSafeInteger(attr.offset) ||
      !Number.isSafeInteger(attr.length) ||
      attr.length < 0 ||
      attr.offset !== end ||
      attr.bytes !== attr.length * Type.BYTES_PER_ELEMENT ||
      attr.offset + attr.bytes > metadata.byte_length
    )
      throw new Error(`Invalid terrain mesh attribute: ${name}`);
    end = align(attr.offset + attr.bytes);
    if (include_attributes) {
      const array = new Type(attr.length);
      new Uint8Array(array.buffer).set(
        raw.subarray(start + attr.offset, start + attr.offset + attr.bytes),
      );
      result[name] = array;
    }
  }
  if (
    end !== metadata.byte_length ||
    metadata.attributes.positions.length !== 257 * 257 * 3 ||
    metadata.attributes.uvs.length !== 257 * 257 * 2 ||
    metadata.attributes.patterns.length !== 256 * 256 ||
    metadata.attributes.iterations.length !== 256 * 256 ||
    metadata.attributes.indices.length % 3 !== 0 ||
    metadata.vertex_count !== 257 * 257 ||
    metadata.triangle_count !== metadata.attributes.indices.length / 3
  )
    throw new Error("Invalid terrain mesh dimensions");
  return result;
}
