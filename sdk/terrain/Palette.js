import FractoColors, { GREY_BASE, GREY_RANGE } from "../FractoColors.js";

/** Shared view-dependent tones prevent independently shaded tile boundaries. */
export function terrain_palette(entries, region) {
  const bins = { escaped: {}, inner: {}, outer: {} };
  const totals = { escaped: 0, inner: 0, outer: 0 };
  const bounds = region.bounds;
  for (const { mesh, tile } of entries) {
    const size = tile.bounds.right - tile.bounds.left;
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 256; x++) {
        const index = y * 256 + x,
          pattern = mesh.patterns[index],
          iteration = mesh.iterations[index];
        if (pattern === -2147483648 || !Number.isFinite(iteration)) continue;
        const px = tile.bounds.left + ((x + 0.5) * size) / 256;
        const half_sample = size / 512;
        if (px + half_sample <= bounds.left || px - half_sample >= bounds.right)
          continue;
        const py = tile.bounds.top - ((y + 0.5) * size) / 256;
        const category =
          pattern === 0 ? "escaped" : pattern < 0 ? "inner" : "outer";
        const key = `_${Math.abs(iteration)}`;
        for (const instance of tile.instances) {
          const placed_y = instance.mirror_y ? -py : py;
          if (
            placed_y + half_sample <= bounds.bottom ||
            placed_y - half_sample >= bounds.top
          )
            continue;
          bins[category][key] = (bins[category][key] || 0) + 1;
          totals[category]++;
        }
      }
  }
  return Object.fromEntries(
    Object.keys(bins).map((category) => [
      category,
      FractoColors.get_greys_map(
        { length: totals[category] },
        bins[category],
        category === "escaped" ? GREY_BASE : 15,
        category === "escaped" ? GREY_RANGE : 40,
      ),
    ]),
  );
}

/** Extend the fixed base-view transfer function to iteration values found only in finer tiles. */
export function terrain_palette_mapper(palette) {
  const anchors = Object.fromEntries(
    Object.entries(palette).map(([category, values]) => [
      category,
      Object.entries(values)
        .map(([key, tone]) => [Number(key.slice(1)), tone])
        .sort((a, b) => a[0] - b[0]),
    ]),
  );
  return (mesh) => {
    const maps = Object.fromEntries(
      Object.entries(palette).map(([category, values]) => [
        category,
        { ...values },
      ]),
    );
    for (let i = 0; i < mesh.patterns.length; i++) {
      const pattern = mesh.patterns[i],
        value = Math.abs(mesh.iterations[i]);
      if (pattern === -2147483648 || !Number.isFinite(value)) continue;
      const category =
          pattern === 0 ? "escaped" : pattern < 0 ? "inner" : "outer",
        key = `_${value}`;
      if (maps[category][key] !== undefined) continue;
      const points = anchors[category];
      let low = 0,
        high = points.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (points[middle][0] < value) low = middle + 1;
        else high = middle;
      }
      const left = points[Math.max(0, low - 1)],
        right = points[Math.min(points.length - 1, low)];
      maps[category][key] = !left
        ? category === "escaped"
          ? GREY_BASE + GREY_RANGE / 2
          : 35
        : left[0] === right[0]
          ? left[1]
          : left[1] +
            ((right[1] - left[1]) * (value - left[0])) / (right[0] - left[0]);
    }
    return maps;
  };
}
