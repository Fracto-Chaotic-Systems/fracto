export const TILE_EDGE = 256;
export const MIN_FLIGHT_TILE_LEVEL = 3;
export const MAX_FLIGHT_TILE_LEVEL = 34;

// The 32 canonical level-three roots are shared by every frame's ray lookups.
const ROOT_CODES = Array.from({ length: 32 }, (_, index) => {
  const col = index % 8,
    row = Math.floor(index / 8);
  return [4, 2, 1]
    .map((bit) => (Math.floor(col / bit) % 2) + 2 * (Math.floor(row / bit) % 2))
    .join("");
});

export function validate_tile_code(code) {
  if (typeof code !== "string" || !/^[01][0-3]{2,33}$/.test(code))
    throw new RangeError(
      "Expected a canonical upper-plane tile code at level 3 through 34",
    );
  return code;
}

export function tile_bounds(code) {
  validate_tile_code(code);
  let left = -2,
    top = 2,
    scope = 4;
  for (const digit of code) {
    scope /= 2;
    if (Number(digit) % 2) left += scope;
    if (Number(digit) >= 2) top -= scope;
  }
  return { left, right: left + scope, top, bottom: top - scope };
}

/** Canonical north tile for a world point, using conjugate symmetry south of zero. */
export function tile_code_for_point(re, im, level = MIN_FLIGHT_TILE_LEVEL) {
  if (
    !Number.isInteger(level) ||
    level < MIN_FLIGHT_TILE_LEVEL ||
    level > MAX_FLIGHT_TILE_LEVEL
  )
    throw new RangeError("Invalid flight tile level");
  if (
    !Number.isFinite(re) ||
    !Number.isFinite(im) ||
    re < -2 ||
    re >= 2 ||
    Math.abs(im) > 2
  )
    return null;
  const edge = 2 ** level,
    size = 4 / edge;
  const col = Math.min(edge - 1, Math.floor((re + 2) / size));
  const row = Math.min(edge / 2 - 1, Math.floor((2 - Math.abs(im)) / size));
  if (level === MIN_FLIGHT_TILE_LEVEL) return ROOT_CODES[row * 8 + col];
  let code = "";
  for (let bit = level - 1; bit >= 0; bit--)
    code +=
      (Math.floor(col / 2 ** bit) % 2) + 2 * (Math.floor(row / 2 ** bit) % 2);
  return code;
}

/** Same nearest-sample convention as the existing numerical 2D rasterizer. */
export function tile_sample_indices(code, re, im) {
  const bounds = tile_bounds(code),
    north = Math.abs(im);
  if (
    !Number.isFinite(re) ||
    !Number.isFinite(im) ||
    re < bounds.left ||
    re > bounds.right ||
    north < bounds.bottom ||
    north > bounds.top
  )
    return null;
  const increment = (bounds.right - bounds.left) / TILE_EDGE;
  const i = Math.max(
    0,
    Math.min(255, Math.round((re - bounds.left) / increment)),
  );
  const j = Math.max(
    0,
    Math.min(255, Math.round((bounds.top - north) / increment)),
  );
  return { i, j, index: j * TILE_EDGE + i };
}

export function validate_tile_data(data) {
  if (!Array.isArray(data) || data.length !== TILE_EDGE)
    throw new TypeError("Invalid tile columns");
  for (const column of data) {
    if (!Array.isArray(column) || column.length !== TILE_EDGE)
      throw new TypeError("Invalid tile rows");
    for (const pair of column)
      if (
        pair !== null &&
        (!Array.isArray(pair) ||
          pair.length !== 2 ||
          !Number.isSafeInteger(pair[0]) ||
          !Number.isFinite(pair[1]))
      )
        throw new TypeError("Invalid tile sample");
  }
  return data;
}
