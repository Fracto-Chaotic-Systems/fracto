const intersects = (a, b) =>
  a.left < b.right && a.right > b.left && a.top > b.bottom && a.bottom < b.top;
const group_id = (code, mirror_y) => `${code}/${mirror_y ? 1 : 0}`;

/** One available child quartet per physical parent placement, including conjugate views. */
export function terrain_refinements(inventory, tiles, region) {
  const groups = [];
  for (const tile of tiles) {
    if (tile.short_code.length >= 34) continue;
    const children = [0, 1, 2, 3].map((digit) =>
      inventory.get(`${tile.short_code}${digit}`),
    );
    if (!children.every((child) => child?.status === "ready")) continue;
    for (const instance of tile.instances) {
      groups.push({
        id: group_id(tile.short_code, instance.mirror_y),
        parent_short_code: tile.short_code,
        mirror_y: instance.mirror_y,
        bounds: instance.bounds,
        children: children.map(({ short_code, bounds, sha256 }) => {
          const placement = instance.mirror_y
            ? { ...bounds, top: -bounds.bottom, bottom: -bounds.top }
            : bounds;
          return {
            short_code,
            bounds,
            sha256,
            instances: intersects(placement, region.bounds)
              ? [{ mirror_y: instance.mirror_y, bounds: placement }]
              : [],
          };
        }),
      });
    }
  }
  return groups;
}

/** Include parents as fallbacks while child files load. Fetch canonical files only once. */
export function request_lod_plan(base, ids) {
  const base_tiles = base.base_tiles || base.tiles;
  const wanted = new Set(ids);
  const selected = (base.refinements || []).filter((group) =>
    wanted.has(group.id),
  );
  const tiles = new Map(
    base_tiles.map((tile) => [
      tile.short_code,
      { ...tile, instances: [...tile.instances] },
    ]),
  );
  for (const group of selected)
    for (const child of group.children) {
      if (!tiles.has(child.short_code))
        tiles.set(child.short_code, { ...child, instances: [] });
      const tile = tiles.get(child.short_code);
      for (const instance of child.instances)
        if (
          !tile.instances.some((other) => other.mirror_y === instance.mirror_y)
        )
          tile.instances.push(instance);
    }
  return {
    ...base,
    base_tiles,
    tiles: [...tiles.values()],
    requested_refinements: selected.map((group) => group.id).sort(),
  };
}

/** Atomic quartet replacement: any failed child retains the corresponding parent placement. */
export function resolve_lod_plan(request, available) {
  const base_tiles = request.base_tiles || request.tiles;
  const wanted = new Set(request.requested_refinements || []);
  const selected = (request.refinements || []).filter(
    (group) =>
      wanted.has(group.id) &&
      group.children.every((child) => available.has(child.short_code)),
  );
  const refined = new Set(selected.map((group) => group.id));
  const tiles = new Map();
  for (const tile of base_tiles) {
    const instances = tile.instances.filter(
      (instance) => !refined.has(group_id(tile.short_code, instance.mirror_y)),
    );
    if (instances.length && available.has(tile.short_code))
      tiles.set(tile.short_code, { ...tile, instances });
  }
  for (const group of selected)
    for (const child of group.children) {
      if (!child.instances.length) continue;
      if (!tiles.has(child.short_code))
        tiles.set(child.short_code, { ...child, instances: [] });
      tiles.get(child.short_code).instances.push(...child.instances);
    }
  return {
    ...request,
    base_tiles,
    tiles: [...tiles.values()],
    refined_groups: [...refined].sort(),
    detail_level:
      request.level === null ? null : request.level + (refined.size ? 1 : 0),
  };
}
