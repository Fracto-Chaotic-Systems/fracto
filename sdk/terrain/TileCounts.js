/** Count canonical indexed tiles without allocating tile records or reading files. */
export function count_indexed_tiles_in_scope(
  level_data,
  focal_point,
  scope,
  aspect_ratio = 1,
) {
  if (!level_data?.columns?.length) return 0;
  const size = level_data.tile_size;
  const left = focal_point.x - scope / 2,
    right = focal_point.x + scope / 2;
  const bottom = focal_point.y - (scope * aspect_ratio) / 2,
    top = focal_point.y + (scope * aspect_ratio) / 2;
  let count = 0;
  for (const column of level_data.columns) {
    if (column.left >= right || column.left + size <= left) continue;
    if (bottom <= -2 && top >= 2) {
      count += column.tiles.length;
      continue;
    }
    for (const tile of column.tiles) {
      const y = tile.bottom;
      if (
        (y < top && y + size > bottom) ||
        (y >= 0 && -y > bottom && -(y + size) < top)
      )
        count++;
    }
  }
  return count;
}
