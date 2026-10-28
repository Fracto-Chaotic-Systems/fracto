// Limits apply before allocating the nested buffer or materializing query results.
export const MESH_HEAT_MAP_LIMITS = Object.freeze({
  max_edge: 2048,
  max_pixels: 1048576,
  max_meshes: 100000,
});

const invalid_view = () =>
  Object.assign(new Error("Invalid mesh heat-map viewport"), {
    code: "MESH_HEAT_MAP_VIEW",
  });
const numeric = (value) => {
  if (
    !["number", "string"].includes(typeof value) ||
    String(value).trim() === ""
  )
    throw invalid_view();
  const result = Number(value);
  if (!Number.isFinite(result)) throw invalid_view();
  return result;
};

export function mesh_heat_map_view(query) {
  const width_px = numeric(query.width_px),
    scope = numeric(query.scope);
  const focal_point = {
    x: numeric(query.focal_point_x),
    y: numeric(query.focal_point_y),
  };
  const aspect_ratio =
    query.aspect_ratio === undefined ? 1 : numeric(query.aspect_ratio);
  const height_px = Math.round(width_px * aspect_ratio);
  const left = focal_point.x - scope / 2,
    right = focal_point.x + scope / 2;
  const top = focal_point.y + (scope * aspect_ratio) / 2,
    bottom = focal_point.y - (scope * aspect_ratio) / 2;
  const { max_edge, max_pixels } = MESH_HEAT_MAP_LIMITS;
  if (
    !Number.isSafeInteger(width_px) ||
    width_px < 1 ||
    width_px > max_edge ||
    height_px < 1 ||
    height_px > max_edge ||
    width_px * height_px > max_pixels ||
    scope <= 0 ||
    aspect_ratio <= 0 ||
    ![left, right, top, bottom].every(Number.isFinite) ||
    left >= right ||
    bottom >= top
  )
    throw invalid_view();
  return { width_px, height_px, focal_point, scope, aspect_ratio, left, top };
}

/** Pure inventory lookup and rasterization: no filesystem, mesh decode, or tile reads. */
export function mesh_heat_map(inventory, query) {
  const view = mesh_heat_map_view(query),
    start = performance.now();
  const { width_px, height_px, focal_point, scope, aspect_ratio, left, top } =
    view;
  const inventory_revision = inventory.revision,
    namespace = inventory.namespace;
  const levels = [],
    coverage = [];
  let remaining = MESH_HEAT_MAP_LIMITS.max_meshes;
  for (let level = 2; level <= 34; level++) {
    const meshes = inventory.tiles_in_scope(
      level,
      focal_point,
      scope,
      aspect_ratio,
      { limit: remaining },
    );
    remaining -= meshes.length;
    if (!meshes.length) continue;
    levels.push({ level, meshes });
    coverage.push({
      level,
      mesh_count: meshes.length,
      compressed_bytes: meshes.reduce(
        (sum, mesh) => sum + mesh.compressed_bytes,
        0,
      ),
      pixel_count: 0,
    });
  }
  const lookup_end = performance.now();
  const pixels = new Uint8Array(width_px * height_px),
    increment = scope / width_px;
  const real = Float64Array.from(
    { length: width_px },
    (_, x) => left + (x + 0.5) * increment,
  );
  const imaginary = Float64Array.from(
    { length: height_px },
    (_, y) => top - (y + 0.5) * increment,
  );
  const paint = (bounds, reflected) => {
    const min_y = reflected ? -bounds.top : bounds.bottom;
    const max_y = reflected ? -bounds.bottom : bounds.top;
    // Pixel centers, with left/top inclusive and right/bottom exclusive bounds.
    // Conservatively bound candidates, then compare actual sample coordinates.
    // Division rounding at an exact tile edge must not add or drop a pixel.
    const x0 = Math.max(0, Math.floor((bounds.left - left) / increment - 0.5));
    const x1 = Math.min(
      width_px - 1,
      Math.ceil((bounds.right - left) / increment - 0.5),
    );
    const y0 = Math.max(0, Math.floor((top - max_y) / increment - 0.5));
    const y1 = Math.min(
      height_px - 1,
      Math.ceil((top - min_y) / increment - 0.5),
    );
    return { x0, x1, y0, y1, min_y, max_y };
  };
  // Descending levels and first-write wins preserve the finest available mesh.
  for (let i = levels.length - 1; i >= 0; i--) {
    const { level, meshes } = levels[i];
    for (const mesh of meshes) {
      const rectangles = [paint(mesh.bounds, false)];
      if (mesh.bounds.bottom >= 0) rectangles.push(paint(mesh.bounds, true));
      for (const { x0, x1, y0, y1, min_y, max_y } of rectangles)
        for (let x = x0; x <= x1; x++) {
          if (real[x] < mesh.bounds.left || real[x] >= mesh.bounds.right)
            continue;
          for (let y = y0; y <= y1; y++) {
            const offset = x * height_px + y;
            if (
              !pixels[offset] &&
              imaginary[y] <= max_y &&
              imaginary[y] > min_y
            )
              pixels[offset] = level;
          }
        }
    }
  }
  const counts = new Uint32Array(35);
  const heat_map_buffer = Array.from({ length: width_px }, (_, x) =>
    Array.from({ length: height_px }, (_, y) => {
      const level = pixels[x * height_px + y];
      counts[level]++;
      return [0, level];
    }),
  );
  for (const row of coverage) row.pixel_count = counts[row.level];
  const end = performance.now();
  return {
    heat_map_buffer,
    coverage,
    inventory_revision,
    namespace,
    width_px,
    height_px,
    uncovered_pixel_count: counts[0],
    timings_ms: {
      index_lookup: lookup_end - start,
      rasterization: end - lookup_end,
      total: end - start,
    },
  };
}
