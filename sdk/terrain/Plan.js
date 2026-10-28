import FractoUtil from "../FractoUtil.js";

const parse = (value) =>
  typeof value === "string" ? JSON.parse(value) : value;

export function terrain_region(record) {
  const settings = parse(record?.display_settings);
  const focal_point = parse(settings?.focal_point);
  const valid_coordinate = (value) =>
    value !== null &&
    value !== undefined &&
    value !== "" &&
    Number.isFinite(Number(value));
  const scope = Number(settings?.scope),
    aspect_ratio = Number(settings?.aspect_ratio ?? 1);
  if (
    !Number.isFinite(scope) ||
    scope <= 0 ||
    !Number.isFinite(aspect_ratio) ||
    aspect_ratio <= 0 ||
    !valid_coordinate(focal_point?.x) ||
    !valid_coordinate(focal_point?.y)
  ) {
    throw new Error("Entry has invalid display settings");
  }
  const x = Number(focal_point.x),
    y = Number(focal_point.y);
  const region = {
    left: x - scope / 2,
    right: x + scope / 2,
    top: y + (scope * aspect_ratio) / 2,
    bottom: y - (scope * aspect_ratio) / 2,
  };
  if (
    region.left < -2 ||
    region.right > 2 ||
    region.bottom < -2 ||
    region.top > 2
  ) {
    throw new Error("Display region extends outside the indexed complex plane");
  }
  return { focal_point: { x, y }, scope, aspect_ratio, bounds: region };
}

export function terrain_level(region, minimum_resolution = 1000) {
  if (
    !Number.isSafeInteger(minimum_resolution) ||
    minimum_resolution < 2 ||
    minimum_resolution > 5000
  )
    throw new Error("Minimum resolution must be an integer from 2 to 5000");
  const short_span = region.scope * Math.min(1, region.aspect_ratio);
  const level = Math.max(
    2,
    Math.ceil(Math.log2((4 * (minimum_resolution - 1)) / (256 * short_span))),
  );
  if (level > 34)
    throw new Error("Required resolution exceeds the indexed tile levels");
  return level;
}

function grid_code(column, row, level) {
  let code = "";
  for (let bit = level - 1; bit >= 0; bit--) {
    const divisor = 2 ** bit;
    code +=
      2 * (Math.floor(row / divisor) % 2) + (Math.floor(column / divisor) % 2);
  }
  return code;
}

/** Coarsest native spacing meeting the minimum along both display-region axes. */
export function plan_terrain_tiles(
  record,
  indexed_codes,
  minimum_resolution = 1000,
) {
  const region = terrain_region(record),
    level = terrain_level(region, minimum_resolution);
  const size = 2 ** (2 - level),
    cells = 2 ** level;
  const bounds = region.bounds;
  const first_x = Math.floor((bounds.left + 2) / size);
  const last_x = Math.ceil((bounds.right + 2) / size) - 1;
  const first_y = Math.floor((2 - bounds.top) / size);
  const last_y = Math.ceil((2 - bounds.bottom) / size) - 1;
  if ((last_x - first_x + 1) * (last_y - first_y + 1) > 1024)
    throw new Error("Test region requires too many tiles");
  const requested = new Map();
  for (let row = first_y; row <= last_y; row++) {
    for (let column = first_x; column <= last_x; column++) {
      const mirrored = row >= cells / 2;
      const short_code = grid_code(
        column,
        mirrored ? cells - row - 1 : row,
        level,
      );
      const placement = {
        mirror_y: mirrored,
        bounds: FractoUtil.bounds_from_short_code(
          grid_code(column, row, level),
        ),
      };
      if (!requested.has(short_code))
        requested.set(short_code, {
          short_code,
          bounds: FractoUtil.bounds_from_short_code(short_code),
          instances: [],
        });
      requested.get(short_code).instances.push(placement);
    }
  }
  const tiles = [],
    missing_tiles = [];
  for (const tile of requested.values())
    (indexed_codes.has(tile.short_code) ? tiles : missing_tiles).push(tile);
  return {
    schema_version: 1,
    bailiwick_id: Number(record.id),
    region,
    level,
    minimum_resolution,
    native_resolution: {
      x: Math.floor((region.scope * 256) / size + 1e-9) + 1,
      y:
        Math.floor((region.scope * region.aspect_ratio * 256) / size + 1e-9) +
        1,
    },
    sample_spacing: size / 256,
    tiles,
    missing_tiles,
    boundary_policy: "clamp-local-v1",
    neighbor_stitching: "deferred",
  };
}
