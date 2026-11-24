import { generate_component_scatter } from "../FractoComponentScatter.js";
import { component_reference_key } from "../FractoComponentTools.js";

// Independent semantic scoring: do not infer success merely from valid commands
// or from the presence of an exclusion rectangle in a scatter rule.
export function construction_instances(document, materials) {
  const instances = document.objects.map((item) => ({
    ...item,
    asset: item.asset,
  }));
  for (const rule of document.scatters) {
    const facts =
      materials[component_reference_key(rule.asset)].material.construction;
    instances.push(
      ...generate_component_scatter(rule, facts).map((item) => ({
        ...item,
        asset: rule.asset,
      })),
    );
  }
  return instances.map((item) => {
    const facts =
      materials[component_reference_key(item.asset)].material.construction;
    const [x, , z] = item.position,
      [sx, , sz] = item.scale,
      yaw = item.rotation[1],
      [width, depth] = facts.footprint_m;
    const hx =
      (Math.abs(Math.cos(yaw)) * width * sx +
        Math.abs(Math.sin(yaw)) * depth * sz) /
      2;
    const hz =
      (Math.abs(Math.sin(yaw)) * width * sx +
        Math.abs(Math.cos(yaw)) * depth * sz) /
      2;
    return {
      ...item,
      bounds: [x - hx, z - hz, x + hx, z + hz],
      height_m: facts.dimensions_m[1] * item.scale[1],
    };
  });
}
export function measure_construction_build(document, materials, expected) {
  const instances = construction_instances(document, materials),
    counts = {};
  for (const item of instances)
    counts[item.asset.id] = (counts[item.asset.id] || 0) + 1;
  const rects = [
    ...(expected.exclusions || []),
    ...(expected.corridor_width
      ? [[-expected.corridor_width / 2, -1e5, expected.corridor_width / 2, 1e5]]
      : []),
  ];
  const intersections = instances.filter((item) =>
    rects.some(
      (rect) =>
        item.bounds[0] <= rect[2] &&
        item.bounds[2] >= rect[0] &&
        item.bounds[1] <= rect[3] &&
        item.bounds[3] >= rect[1],
    ),
  ).length;
  const outside = expected.area
    ? instances.filter(
        ({ bounds: b }) =>
          b[0] < expected.area[0] ||
          b[1] < expected.area[1] ||
          b[2] > expected.area[2] ||
          b[3] > expected.area[3],
      ).length
    : 0;
  const mismatch = Object.keys({ ...counts, ...expected.counts }).reduce(
    (sum, id) => sum + Math.abs((counts[id] || 0) - (expected.counts[id] || 0)),
    0,
  );
  const checks = {
    floor:
      JSON.stringify(document.floor?.size) ===
      JSON.stringify(expected.floor_size),
    counts: mismatch === 0,
    clearance: intersections === 0,
    area: outside === 0,
    scale: instances.every((item) => item.height_m > 0 && item.height_m <= 12),
  };
  if (expected.position)
    checks.position =
      JSON.stringify(document.objects[0]?.position) ===
      JSON.stringify(expected.position);
  if (expected.scale)
    checks.authored_scale =
      JSON.stringify(document.objects[0]?.scale) ===
      JSON.stringify(expected.scale);
  if (Object.hasOwn(expected, "floor_material"))
    checks.floor_material =
      (document.floor?.asset?.id || null) === expected.floor_material;
  if (expected.texture_repeat)
    checks.texture_repeat =
      JSON.stringify(document.floor?.texture_repeat) ===
      JSON.stringify(expected.texture_repeat);
  return {
    checks,
    passed: Object.values(checks).every(Boolean),
    instances: instances.length,
    counts,
    exclusion_intersections: intersections,
    outside_area: outside,
    count_error: mismatch,
    correction_proxy: Object.values(checks).filter((value) => !value).length,
  };
}
