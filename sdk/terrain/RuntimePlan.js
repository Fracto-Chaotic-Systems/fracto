import { terrain_level } from "./Plan.js";

export const MAX_RUNTIME_MESHES = 64;
const invalid = () =>
  Object.assign(new Error("Invalid terrain request"), {
    code: "MESH_TERRAIN_VIEW",
  });

/** Select one bounded native level, preferring complete indexed coverage. No file reads. */
export function plan_runtime_terrain(inventory, query, count_tiles) {
  const region = {
    focal_point: {
      x: Number(query.focal_point_x),
      y: Number(query.focal_point_y),
    },
    scope: Number(query.scope),
    aspect_ratio: Number(query.aspect_ratio ?? 1),
  };
  const minimum_resolution = Number(query.minimum_resolution ?? 1000);
  const { focal_point, scope, aspect_ratio } = region;
  if (
    !Number.isFinite(focal_point.x) ||
    !Number.isFinite(focal_point.y) ||
    !Number.isFinite(scope) ||
    scope <= 0 ||
    !Number.isFinite(aspect_ratio) ||
    aspect_ratio <= 0
  )
    throw invalid();
  region.bounds = {
    left: focal_point.x - scope / 2,
    right: focal_point.x + scope / 2,
    top: focal_point.y + (scope * aspect_ratio) / 2,
    bottom: focal_point.y - (scope * aspect_ratio) / 2,
  };
  if (
    !Object.values(region.bounds).every(Number.isFinite) ||
    region.bounds.left >= region.bounds.right ||
    region.bounds.bottom >= region.bounds.top
  )
    throw invalid();
  let required_level;
  try {
    required_level = terrain_level(region, minimum_resolution);
  } catch {
    throw invalid();
  }
  const summary = inventory.summary();
  const levels = summary.levels
    .filter((row) => row.ready > 0)
    .map((row) => row.level)
    .sort(
      (a, b) =>
        (a >= required_level ? a - required_level : 100 + required_level - a) -
        (b >= required_level ? b - required_level : 100 + required_level - b),
    );
  let selected;
  for (const level of levels) {
    const expected = count_tiles(level, focal_point, scope, aspect_ratio);
    if (expected > MAX_RUNTIME_MESHES) continue;
    let records;
    try {
      records = inventory.tiles_in_scope(
        level,
        focal_point,
        scope,
        aspect_ratio,
        { limit: MAX_RUNTIME_MESHES },
      );
    } catch (error) {
      if (error.code === "MESH_QUERY_LIMIT") continue;
      throw error;
    }
    if (!records.length) continue;
    const candidate = {
      level,
      records,
      missing_count: Math.max(0, expected - records.length),
    };
    if (!selected) selected = candidate;
    if (!candidate.missing_count) {
      selected = candidate;
      break;
    }
  }
  const level = selected?.level ?? null;
  const spacing = level === null ? null : 2 ** (2 - level) / 256;
  const intersects = (b) =>
    b.left < region.bounds.right &&
    b.right > region.bounds.left &&
    b.top > region.bounds.bottom &&
    b.bottom < region.bounds.top;
  const tiles = (selected?.records || []).map((record) => {
    const { short_code, bounds, sha256 } = record;
    const instances = [];
    if (intersects(bounds)) instances.push({ mirror_y: false, bounds });
    const reflected = { ...bounds, top: -bounds.bottom, bottom: -bounds.top };
    if (bounds.bottom >= 0 && intersects(reflected))
      instances.push({ mirror_y: true, bounds: reflected });
    return { short_code, sha256, bounds, instances };
  });
  const native_resolution = spacing
    ? {
        x: Math.floor(scope / spacing + 1e-9) + 1,
        y: Math.floor((scope * aspect_ratio) / spacing + 1e-9) + 1,
      }
    : { x: 0, y: 0 };
  return {
    region,
    minimum_resolution,
    required_level,
    level,
    native_resolution,
    minimum_met:
      Math.min(native_resolution.x, native_resolution.y) >= minimum_resolution,
    missing_count: selected?.missing_count ?? null,
    tiles,
    namespace: summary.namespace,
    inventory_epoch: summary.inventory_epoch,
    inventory_revision: summary.revision,
    mesh_limit: MAX_RUNTIME_MESHES,
    boundary_policy: "clamp-local-v1",
  };
}
