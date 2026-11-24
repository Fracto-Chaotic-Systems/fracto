import { validate_component_document } from "./FractoComponentDocument.js";
import { validate_material_construction } from "./FractoMaterialMetadata.js";
import {
  generate_component_scatter,
  COMPONENT_SCATTER_ALGORITHM,
} from "./FractoComponentScatter.js";
const fail = (code = "invalid_construction_command") => {
  throw new Error(code);
};
const shape = (value, keys) => {
  if (
    !value ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail();
};
export const component_reference_key = (reference) =>
  `${reference.id}:${reference.revision}`;
export const COMPONENT_MATERIAL_LIMIT = 128;
export function require_component_material(reference, materials, kind) {
  const descriptor = materials[component_reference_key(reference)];
  if (
    !descriptor ||
    descriptor.material.id !== reference.id ||
    descriptor.material.revision !== reference.revision
  )
    fail("material_revision_changed");
  const facts = validate_material_construction(
    descriptor.material.construction,
  );
  if (facts.kind !== kind || facts.placement === "unknown")
    fail("material_not_calibrated");
  if (
    kind === "model" &&
    [
      "meters_per_unit",
      "dimensions_m",
      "up_axis",
      "forward_axis",
      "ground_anchor_m",
      "footprint_m",
    ].some((key) => facts[key] === null)
  )
    fail("material_not_calibrated");
  if (
    kind === "surface" &&
    (facts.texture_size_m === null || facts.placement !== "floor")
  )
    fail("material_not_calibrated");
  return descriptor;
}
export function validate_component_materials(document, materials) {
  for (const object of document.objects)
    require_component_material(object.asset, materials, "model");
  for (const rule of document.scatters) {
    const descriptor = require_component_material(
      rule.asset,
      materials,
      "model",
    );
    if (descriptor.material.construction.placement !== "ground")
      fail("material_not_calibrated");
    generate_component_scatter(rule, descriptor.material.construction);
  }
  if (document.floor?.asset) {
    const descriptor = require_component_material(
      document.floor.asset,
      materials,
      "surface",
    );
    if (
      !document.floor.texture_file ||
      !descriptor.runtime.resources.includes(document.floor.texture_file) ||
      !/\.(png|jpe?g|webp)$/i.test(document.floor.texture_file)
    )
      fail("floor_texture_missing");
  }
  return document;
}
// One batch returns one snapshot; no mutation or partial application on failure.
export function apply_component_commands(document, commands, materials = {}) {
  const next = validate_component_document(document);
  if (!Array.isArray(commands) || !commands.length || commands.length > 100)
    fail();
  for (const command of commands) {
    if (!command || typeof command !== "object" || Array.isArray(command))
      fail();
    switch (command.type) {
      case "set-floor":
        shape(command, ["type", "floor"]);
        next.floor = structuredClone(command.floor);
        break;
      case "place":
        shape(command, ["type", "object"]);
        next.objects.push(structuredClone(command.object));
        break;
      case "place-pattern":
        shape(command, ["type", "asset", "instances"]);
        if (
          !Array.isArray(command.instances) ||
          !command.instances.length ||
          command.instances.length > 1000 ||
          next.objects.length +
            next.scatters.reduce((n, rule) => n + rule.count, 0) +
            command.instances.length >
            1000
        )
          fail();
        for (const instance of command.instances) {
          shape(instance, ["id", "position", "rotation", "scale"]);
          next.objects.push({
            ...structuredClone(instance),
            asset: structuredClone(command.asset),
            group_id: null,
          });
        }
        break;
      case "place-pattern":
        shape(command, ["type", "asset", "instances"]);
        if (
          !Array.isArray(command.instances) ||
          !command.instances.length ||
          command.instances.length > 1000 ||
          next.objects.length +
            next.scatters.reduce((n, rule) => n + rule.count, 0) +
            command.instances.length >
            1000
        )
          fail();
        for (const instance of command.instances) {
          shape(instance, ["id", "position", "rotation", "scale"]);
          next.objects.push({
            ...structuredClone(instance),
            asset: structuredClone(command.asset),
            group_id: null,
          });
        }
        break;
      case "transform": {
        shape(command, ["type", "id", "position", "rotation", "scale"]);
        const object = next.objects.find((item) => item.id === command.id);
        if (!object) fail();
        Object.assign(object, {
          position: structuredClone(command.position),
          rotation: structuredClone(command.rotation),
          scale: structuredClone(command.scale),
        });
        break;
      }
      case "scatter": {
        shape(command, ["type", "rule"]);
        if (
          !command.rule ||
          typeof command.rule !== "object" ||
          Array.isArray(command.rule)
        )
          fail();
        const index = next.scatters.findIndex(
          (rule) => rule.id === command.rule.id,
        );
        const rule = {
          ...structuredClone(command.rule),
          algorithm: command.rule.algorithm ?? COMPONENT_SCATTER_ALGORITHM,
        };
        if (index < 0) next.scatters.push(rule);
        else next.scatters[index] = rule;
        break;
      }
      case "remove": {
        shape(command, ["type", "id"]);
        if (
          !next.objects.some((item) => item.id === command.id) &&
          !next.scatters.some((item) => item.id === command.id)
        )
          fail();
        next.objects = next.objects.filter((item) => item.id !== command.id);
        next.scatters = next.scatters.filter((item) => item.id !== command.id);
        break;
      }
      default:
        fail();
    }
  }
  const valid = validate_component_document(next);
  const references = [
    valid.floor?.asset,
    ...valid.objects.map((item) => item.asset),
    ...valid.scatters.map((rule) => rule.asset),
  ].filter(Boolean);
  if (
    new Set(references.map(component_reference_key)).size >
    COMPONENT_MATERIAL_LIMIT
  )
    fail("construction_limit");
  // Permit removal/transform of unrelated items even if another pinned asset is
  // unavailable; newly authored/changed references still require live facts.
  for (const command of commands) {
    if (command.type === "place")
      require_component_material(command.object.asset, materials, "model");
    if (command.type === "place-pattern")
      require_component_material(command.asset, materials, "model");
    if (command.type === "place-pattern")
      require_component_material(command.asset, materials, "model");
    if (command.type === "scatter") {
      const rule = valid.scatters.find((item) => item.id === command.rule.id);
      if (rule)
        validate_component_materials(
          { objects: [], floor: null, scatters: [rule] },
          materials,
        );
    }
    if (command.type === "set-floor" && valid.floor?.asset)
      validate_component_materials(
        { objects: [], scatters: [], floor: valid.floor },
        materials,
      );
  }
  return valid;
}
