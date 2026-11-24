// Pure authoring contract. Services own persistence; editor guides/cameras are not content.
import { validate_component_motion } from "./FractoComponentMotion.js";
export const COMPONENT_SCHEMA_VERSION = 1;
export const COMPONENT_HISTORY_LIMIT = 100;
export const COMPONENT_DESCRIPTION_LIMIT = 65536;
export const DEFAULT_COMPONENT_LIGHTING = Object.freeze({
  direction_degrees: 45,
  intensity: 3,
});
// Stable transport-independent bytes for proposal/base-document binding.
export function component_document_json(document) {
  const sort = (value) =>
    Array.isArray(value)
      ? value.map(sort)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, sort(value[key])]),
          )
        : value;
  return JSON.stringify(sort(validate_component_document(document)));
}
const fail = () => {
  throw new Error("invalid_component_document");
};
const fields = (value, keys) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail();
};
export const validate_component_id = (id) => {
  if (
    typeof id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      id,
    )
  )
    fail();
  return id;
};
const label = (value) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 120 ||
    /[\u0000-\u001f]/.test(value)
  )
    fail();
};
const number = (value, min, max) => {
  if (!Number.isFinite(value) || value < min || value > max) fail();
};
const vector = (value, length, min, max) => {
  if (!Array.isArray(value) || value.length !== length) fail();
  for (const item of value) number(item, min, max);
};
const asset = (value) => {
  fields(value, ["id", "revision"]);
  if (
    typeof value.id !== "string" ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(value.id) ||
    typeof value.revision !== "string" ||
    !/^[A-Za-z0-9._-]{1,128}$/.test(value.revision)
  )
    fail();
};
const array = (value, max) => {
  if (!Array.isArray(value) || value.length > max) fail();
  for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) fail();
};
const bounds = (value) => {
  vector(value, 4, -10000, 10000);
  if (value[0] >= value[2] || value[1] >= value[3]) fail();
};

export function create_component_document(id, name) {
  return validate_component_document({
    schema_version: 1,
    id,
    name,
    units: "m",
    coordinates: "right-handed-y-up",
    floor: null,
    objects: [],
    groups: [],
    scatters: [],
    lighting: { ...DEFAULT_COMPONENT_LIGHTING },
  });
}

export function component_lighting(document) {
  const lighting = Object.hasOwn(document, "lighting")
    ? document.lighting
    : DEFAULT_COMPONENT_LIGHTING;
  fields(lighting, ["direction_degrees", "intensity"]);
  number(lighting.direction_degrees, 0, 360);
  number(lighting.intensity, 0.25, 6);
  return { ...lighting };
}

export function validate_component_document(document) {
  fields(document, [
    "schema_version",
    "id",
    "name",
    "units",
    "coordinates",
    "floor",
    "objects",
    "groups",
    "scatters",
    ...(Object.hasOwn(document, "animation_speed") ? ["animation_speed"] : []),
    ...(Object.hasOwn(document, "lighting") ? ["lighting"] : []),
    ...(Object.hasOwn(document, "construction_description")
      ? ["construction_description"]
      : []),
  ]);
  // Optional v1 authoring property: preserve legacy canonical bytes/hashes when
  // omitted. Consumers interpret omission as 1x; zero explicitly pauses clips.
  if (Object.hasOwn(document, "animation_speed"))
    number(document.animation_speed, 0, 10);
  component_lighting(document);
  if (
    Object.hasOwn(document, "construction_description") &&
    (typeof document.construction_description !== "string" ||
      document.construction_description.length > COMPONENT_DESCRIPTION_LIMIT ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(
        document.construction_description,
      ))
  )
    fail();
  if (
    document.schema_version !== COMPONENT_SCHEMA_VERSION ||
    document.units !== "m" ||
    document.coordinates !== "right-handed-y-up"
  )
    fail();
  validate_component_id(document.id);
  label(document.name);
  array(document.objects, 1000);
  array(document.groups, 100);
  array(document.scatters, 100);
  const ids = new Set();
  const identify = (id) => {
    validate_component_id(id);
    if (ids.has(id) || id === document.id) fail();
    ids.add(id);
  };
  const groups = new Set();
  document.groups.forEach((group) => {
    fields(group, ["id", "name"]);
    identify(group.id);
    label(group.name);
    groups.add(group.id);
  });
  const group_reference = (id) => {
    if (id !== null && !groups.has(id)) fail();
  };
  if (document.floor !== null) {
    fields(document.floor, [
      "asset",
      "size",
      "texture_repeat",
      ...(Object.hasOwn(document.floor, "texture_file")
        ? ["texture_file"]
        : []),
    ]);
    if (document.floor.asset !== null) asset(document.floor.asset);
    if (
      document.floor.texture_file != null &&
      (document.floor.asset === null ||
        typeof document.floor.texture_file !== "string" ||
        document.floor.texture_file.length > 500 ||
        /[\\:\u0000-\u001f]/.test(document.floor.texture_file) ||
        document.floor.texture_file
          .split("/")
          .some((part) => !part || part === "." || part === ".."))
    )
      fail();
    vector(document.floor.size, 2, 0.01, 10000);
    vector(document.floor.texture_repeat, 2, 0.001, 10000);
  }
  document.objects.forEach((object) => {
    fields(object, [
      "id",
      "asset",
      "position",
      "rotation",
      "scale",
      "group_id",
      ...(Object.hasOwn(object, "motion") ? ["motion"] : []),
      ...(Object.hasOwn(object, "animation_speed") ? ["animation_speed"] : []),
    ]);
    identify(object.id);
    asset(object.asset);
    group_reference(object.group_id);
    vector(object.position, 3, -10000, 10000);
    vector(object.rotation, 3, -Math.PI * 2, Math.PI * 2);
    vector(object.scale, 3, 0.001, 1000);
    // Explicit clip clock in native seconds per real second. Omission inherits
    // the component clock; authored patrol translation still uses that clock.
    if (Object.hasOwn(object, "animation_speed"))
      number(object.animation_speed, 0, 10);
    if (Object.hasOwn(object, "motion"))
      validate_component_motion(object.motion);
  });
  let instances = document.objects.length;
  document.scatters.forEach((scatter) => {
    fields(scatter, [
      "id",
      "asset",
      "seed",
      "count",
      "bounds",
      "exclusions",
      "scale",
      "group_id",
      ...(Object.hasOwn(scatter, "algorithm") ? ["algorithm"] : []),
    ]);
    if (
      scatter.algorithm !== undefined &&
      scatter.algorithm !== "footprint-xz-v1"
    )
      fail();
    identify(scatter.id);
    asset(scatter.asset);
    group_reference(scatter.group_id);
    if (!Number.isInteger(scatter.seed) || !Number.isInteger(scatter.count))
      fail();
    number(scatter.seed, 0, 4294967295);
    number(scatter.count, 0, 1000);
    bounds(scatter.bounds);
    array(scatter.exclusions, 32);
    scatter.exclusions.forEach(bounds);
    vector(scatter.scale, 2, 0.001, 1000);
    if (scatter.scale[0] > scatter.scale[1]) fail();
    instances += scatter.count;
  });
  if (instances > 1000 || JSON.stringify(document).length > 500000) fail();
  return structuredClone(document);
}

// Snapshot history groups one committed edit (including a future AI batch) into one undo.
export const create_component_history = (document) => ({
  past: [],
  present: structuredClone(document),
  future: [],
});
export function edit_component_history(history, document) {
  if (JSON.stringify(document) === JSON.stringify(history.present))
    return history;
  return {
    past: [...history.past, history.present].slice(-COMPONENT_HISTORY_LIMIT),
    present: structuredClone(document),
    future: [],
  };
}
export function undo_component_history(history) {
  if (!history.past.length) return history;
  return {
    past: history.past.slice(0, -1),
    present: history.past.at(-1),
    future: [history.present, ...history.future],
  };
}
export function redo_component_history(history) {
  if (!history.future.length) return history;
  return {
    past: [...history.past, history.present].slice(-COMPONENT_HISTORY_LIMIT),
    present: history.future[0],
    future: history.future.slice(1),
  };
}
