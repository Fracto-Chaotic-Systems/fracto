import { createHash } from "node:crypto";

import { TERRAIN_MESH_PROFILE } from "./Profile.js";
export { TERRAIN_MESH_PROFILE };
const KERNEL = [1, 4, 6, 4, 1];

/** Complete uploadable geometry plus original numerical attributes for palette assembly. */
export function build_terrain_tile(tile) {
  if (
    !Array.isArray(tile) ||
    tile.length !== 256 ||
    tile.some((column) => !Array.isArray(column) || column.length !== 256)
  )
    throw new Error("Terrain source tile must be 256 by 256");
  const edge = 257,
    count = edge * edge;
  const heights = new Float64Array(count),
    valid = new Uint8Array(count);
  const patterns = new Int32Array(256 * 256),
    iterations = new Float64Array(256 * 256);
  patterns.fill(-2147483648);
  iterations.fill(NaN);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const sample = tile[x][y],
        index = y * 256 + x;
      if (!sample) continue;
      if (
        !Array.isArray(sample) ||
        sample.length < 2 ||
        !Number.isSafeInteger(sample[0]) ||
        sample[0] < -2147483647 ||
        sample[0] > 2147483647 ||
        !Number.isFinite(sample[1])
      )
        throw new Error("Terrain source tile contains invalid numerical data");
      patterns[index] = sample[0];
      iterations[index] = sample[1];
    }
  for (let y = 0; y < edge; y++)
    for (let x = 0; x < edge; x++) {
      const source = Math.min(y, 255) * 256 + Math.min(x, 255),
        index = y * edge + x;
      if (
        patterns[source] === -2147483648 ||
        patterns[source] === -1 ||
        iterations[source] < 0
      )
        continue;
      valid[index] = 1;
      heights[index] = Math.min(
        1,
        Math.log1p(iterations[source]) / Math.log1p(1000000),
      );
    }
  const sums = new Float64Array(count),
    weights = new Float64Array(count);
  for (let y = 0; y < edge; y++)
    for (let x = 0; x < edge; x++) {
      const index = y * edge + x;
      for (let dx = -2; dx <= 2; dx++) {
        if (x + dx < 0 || x + dx >= edge || !valid[index + dx]) continue;
        sums[index] += heights[index + dx] * KERNEL[dx + 2];
        weights[index] += KERNEL[dx + 2];
      }
    }
  const positions = new Float32Array(count * 3),
    uvs = new Float32Array(count * 2);
  const indices = new Uint32Array(256 * 256 * 6);
  let used = 0,
    maximum_height = 0;
  for (let y = 0; y < edge; y++)
    for (let x = 0; x < edge; x++) {
      const index = y * edge + x;
      let height = 0;
      if (valid[index]) {
        let sum = 0,
          weight = 0;
        for (let dy = -2; dy <= 2; dy++) {
          if (y + dy < 0 || y + dy >= edge) continue;
          const neighbor = (y + dy) * edge + x;
          sum += sums[neighbor] * KERNEL[dy + 2];
          weight += weights[neighbor] * KERNEL[dy + 2];
        }
        height = sum / weight;
      }
      maximum_height = Math.max(maximum_height, height);
      positions.set([x / 256, height, y / 256], index * 3);
      uvs.set(
        [(Math.min(x, 255) + 0.5) / 256, 1 - (Math.min(y, 255) + 0.5) / 256],
        index * 2,
      );
      if (x && y) {
        const a = index - edge - 1,
          b = index - edge,
          c = index - 1;
        if (valid[a] && valid[c] && valid[b]) {
          indices[used++] = a;
          indices[used++] = c;
          indices[used++] = b;
        }
        if (valid[b] && valid[c] && valid[index]) {
          indices[used++] = b;
          indices[used++] = c;
          indices[used++] = index;
        }
      }
    }
  if (!used) throw new Error("Terrain source tile contains no valid surface");
  return {
    positions,
    uvs,
    indices: indices.subarray(0, used),
    patterns,
    iterations,
    vertex_count: count,
    triangle_count: used / 3,
    maximum_height,
    source_sha256: createHash("sha256")
      .update(JSON.stringify(tile))
      .digest("hex"),
  };
}
