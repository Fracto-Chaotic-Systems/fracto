// Portable construction facts. Null means unknown; no model/unit guesses occur here.
const fail = () => {
  throw Object.assign(new Error("invalid_material_metadata"), { status: 400 });
};
export const MATERIAL_PLACEMENTS = [
  "unknown",
  "ground",
  "floor",
  "wall",
  "ceiling",
  "free",
];
export const MATERIAL_AXES = ["x", "-x", "y", "-y", "z", "-z"];
export const MATERIAL_UNITS = ["m", "cm", "mm", "ft", "in"];
export function empty_material_construction() {
  return {
    schema_version: 1,
    kind: "unknown",
    source_units: null,
    meters_per_unit: null,
    dimensions_m: null,
    up_axis: null,
    forward_axis: null,
    ground_anchor_m: null,
    footprint_m: null,
    texture_size_m: null,
    placement: "unknown",
  };
}
export function validate_material_construction(value) {
  const keys = Object.keys(empty_material_construction());
  if (
    !value ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key)) ||
    value.schema_version !== 1
  )
    fail();
  if (
    !["unknown", "model", "surface"].includes(value.kind) ||
    !MATERIAL_PLACEMENTS.includes(value.placement)
  )
    fail();
  if (
    value.source_units !== null &&
    !MATERIAL_UNITS.includes(value.source_units)
  )
    fail();
  if (
    value.meters_per_unit !== null &&
    (!Number.isFinite(value.meters_per_unit) ||
      value.meters_per_unit <= 0 ||
      value.meters_per_unit > 10000)
  )
    fail();
  const conversions = { m: 1, cm: 0.01, mm: 0.001, ft: 0.3048, in: 0.0254 };
  if (
    value.source_units !== null &&
    value.meters_per_unit !== conversions[value.source_units]
  )
    fail();
  for (const key of ["up_axis", "forward_axis"])
    if (value[key] !== null && !MATERIAL_AXES.includes(value[key])) fail();
  if (
    value.up_axis &&
    value.forward_axis &&
    value.up_axis.at(-1) === value.forward_axis.at(-1)
  )
    fail();
  const vector = (key, count, min) => {
    const v = value[key];
    if (v === null) return;
    if (!Array.isArray(v) || v.length !== count) fail();
    for (const n of v) if (!Number.isFinite(n) || n < min || n > 10000) fail();
    if (key === "dimensions_m" && v.every((n) => n === 0)) fail();
  };
  vector("dimensions_m", 3, 0);
  vector("ground_anchor_m", 3, -10000);
  vector("footprint_m", 2, 0.001);
  vector("texture_size_m", 2, 0.001);
  return structuredClone(
    Object.fromEntries(keys.map((key) => [key, value[key]])),
  );
}
export function validate_material_tags(tags) {
  if (!Array.isArray(tags) || tags.length > 32) fail();
  const result = [];
  for (const tag of tags) {
    if (
      typeof tag !== "string" ||
      !tag.trim() ||
      tag.length > 64 ||
      /[\u0000-\u001f\u007f]/.test(tag)
    )
      fail();
    if (!result.includes(tag.trim().toLowerCase()))
      result.push(tag.trim().toLowerCase());
  }
  return result;
}
export function validate_material_edit(body) {
  if (
    !body ||
    Array.isArray(body) ||
    Object.keys(body).length !== 4 ||
    typeof body.revision !== "string" ||
    !/^[a-f0-9]{64}$/.test(body.revision) ||
    typeof body.description !== "string" ||
    body.description.length > 10000 ||
    !Object.hasOwn(body, "tags") ||
    !Object.hasOwn(body, "construction")
  )
    fail();
  return {
    revision: body.revision,
    description: body.description.trim(),
    tags: validate_material_tags(body.tags),
    construction: validate_material_construction(body.construction),
  };
}
export function material_view(record, revision) {
  if (
    typeof record.id !== "string" ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(record.id) ||
    typeof revision !== "string" ||
    !/^[a-f0-9]{64}$/.test(revision) ||
    typeof record.name !== "string" ||
    record.name.length > 255 ||
    (record.description != null &&
      (typeof record.description !== "string" ||
        record.description.length > 10000)) ||
    (record.category != null &&
      (typeof record.category !== "string" || record.category.length > 64))
  )
    fail();
  const construction =
    record.construction === undefined
      ? empty_material_construction()
      : validate_material_construction(record.construction);
  const missing = [];
  if (construction.kind === "unknown") missing.push("kind");
  if (construction.placement === "unknown") missing.push("placement");
  if (construction.kind !== "surface") {
    for (const key of [
      "meters_per_unit",
      "dimensions_m",
      "up_axis",
      "forward_axis",
      "ground_anchor_m",
      "footprint_m",
    ])
      if (construction[key] === null) missing.push(key);
  } else if (construction.texture_size_m === null)
    missing.push("texture_size_m");
  return {
    id: record.id,
    revision,
    name: record.name,
    category: record.category || "environment",
    description: record.description || "",
    tags: validate_material_tags(record.tags || []),
    construction,
    missing_metadata: missing,
    placement_ready: missing.length === 0,
  };
}
