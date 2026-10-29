import FractoUtil from "../FractoUtil.js";

export const MAX_TRANSFORM_TILES = 200000;

/** Snapshot the selected viewport/level, selecting only indexed files without a ready mesh. */
export function plan_mesh_transform(selection, level_data, inventory) {
  const { level, count, region } = selection || {};
  const { focal_point, scope, aspect_ratio = 1 } = region || {};
  if (
    !Number.isSafeInteger(level) ||
    level < 2 ||
    level > 34 ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > MAX_TRANSFORM_TILES ||
    !Number.isFinite(focal_point?.x) ||
    !Number.isFinite(focal_point?.y) ||
    !Number.isFinite(scope) ||
    scope <= 0 ||
    !Number.isFinite(aspect_ratio) ||
    aspect_ratio <= 0
  )
    throw new Error("Invalid transform selection");
  const bounds = {
    left: focal_point.x - scope / 2,
    right: focal_point.x + scope / 2,
    top: focal_point.y + (scope * aspect_ratio) / 2,
    bottom: focal_point.y - (scope * aspect_ratio) / 2,
  };
  if (
    !Object.values(bounds).every(Number.isFinite) ||
    bounds.left >= bounds.right ||
    bounds.bottom >= bounds.top
  )
    throw new Error("Invalid transform region");
  const size = 2 ** (2 - level),
    tiles = [];
  for (const column of level_data?.columns || []) {
    if (column.left >= bounds.right || column.left + size <= bounds.left)
      continue;
    for (const tile of column.tiles) {
      const direct =
        tile.bottom < bounds.top && tile.bottom + size > bounds.bottom;
      const mirror =
        tile.bottom >= 0 &&
        -tile.bottom > bounds.bottom &&
        -(tile.bottom + size) < bounds.top;
      if ((!direct && !mirror) || inventory.has_ready(tile.short_code))
        continue;
      if (tiles.length >= MAX_TRANSFORM_TILES)
        throw new Error("Transform selection is too large");
      const canonical = FractoUtil.bounds_from_short_code(tile.short_code),
        instances = [];
      if (direct) instances.push({ mirror_y: false, bounds: canonical });
      if (mirror)
        instances.push({
          mirror_y: true,
          bounds: {
            ...canonical,
            top: -canonical.bottom,
            bottom: -canonical.top,
          },
        });
      tiles.push({ short_code: tile.short_code, bounds: canonical, instances });
    }
  }
  if (tiles.length !== count)
    throw Object.assign(
      new Error(
        "Available meshes changed; refresh the region and select the count again",
      ),
      { status: 409 },
    );
  tiles.sort(
    (a, b) => a.bounds.left - b.bounds.left || b.bounds.top - a.bounds.top,
  );
  return {
    schema_version: 1,
    kind: "region",
    level,
    coverage_kind: "pending-indexed",
    region: { focal_point: { ...focal_point }, scope, aspect_ratio, bounds },
    sample_spacing: size / 256,
    tiles,
    missing_tiles: [],
    boundary_policy: "clamp-local-v1",
  };
}
