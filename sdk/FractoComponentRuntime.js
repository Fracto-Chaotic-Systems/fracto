import { validate_component_document } from "./FractoComponentDocument.js";
import { validate_material_construction } from "./FractoMaterialMetadata.js";
import {
  COMPONENT_MATERIAL_LIMIT,
  component_reference_key,
  validate_component_materials,
} from "./FractoComponentTools.js";

const fail = () => {
  throw new Error("invalid_component_runtime");
};
export const COMPONENT_RUNTIME_MANIFEST_LIMIT = 2 * 1024 * 1024;
export const COMPONENT_RUNTIME_FILE_LIMIT = 128 * 1024 * 1024;
export function runtime_resource_path(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 512 ||
    /[\\\x00-\x1f\x7f%?#:]/.test(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    fail();
  return value;
}
const shape = (value, keys) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(value, k))
  )
    fail();
};
const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function validate_component_runtime(value) {
  if (JSON.stringify(value)?.length > COMPONENT_RUNTIME_MANIFEST_LIMIT) fail();
  shape(value, [
    "schema_version",
    "source_revision",
    "source_document_sha256",
    "component",
    "materials",
    "files",
  ]);
  if (
    value.schema_version !== 1 ||
    !Number.isInteger(value.source_revision) ||
    value.source_revision < 1 ||
    !digest(value.source_document_sha256)
  )
    fail();
  const component = validate_component_document(value.component);
  if (Object.hasOwn(component, "construction_description")) fail();
  if (
    !Array.isArray(value.materials) ||
    value.materials.length > COMPONENT_MATERIAL_LIMIT ||
    !Array.isArray(value.files) ||
    value.files.length > 8192
  )
    fail();
  const files = new Map();
  let total = 0;
  for (const file of value.files) {
    shape(file, ["path", "sha256", "bytes"]);
    runtime_resource_path(file.path);
    if (
      files.has(file.path) ||
      !digest(file.sha256) ||
      !Number.isInteger(file.bytes) ||
      file.bytes < 1 ||
      file.bytes > COMPONENT_RUNTIME_FILE_LIMIT
    )
      fail();
    files.set(file.path, file);
    total += file.bytes;
  }
  if (total > 2 * 1024 * 1024 * 1024 || !files.has("NOTICE.txt")) fail();
  const materials = {},
    used = new Set(["NOTICE.txt"]);
  for (const descriptor of value.materials) {
    shape(descriptor, ["material", "runtime", "file_paths"]);
    const { material, runtime, file_paths } = descriptor;
    shape(material, ["id", "revision", "construction"]);
    if (
      !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(material.id) ||
      !digest(material.revision)
    )
      fail();
    validate_material_construction(material.construction);
    shape(runtime, ["id", "model", "format", "resources"]);
    if (
      runtime.id !== material.id ||
      !Array.isArray(runtime.resources) ||
      runtime.resources.length > 512 ||
      new Set(runtime.resources).size !== runtime.resources.length
    )
      fail();
    if (
      !file_paths ||
      typeof file_paths !== "object" ||
      Array.isArray(file_paths) ||
      Object.keys(file_paths).length !== runtime.resources.length
    )
      fail();
    if (material.construction.kind === "model") {
      if (
        !["glb", "gltf", "fbx", "obj", "3ds"].includes(runtime.format) ||
        !runtime.resources.includes(runtime.model)
      )
        fail();
    } else if (runtime.model !== null || runtime.format !== null) fail();
    for (const resource of runtime.resources) {
      runtime_resource_path(resource);
      const path = runtime_resource_path(file_paths[resource]);
      if (!files.has(path)) fail();
      used.add(path);
    }
    const key = component_reference_key(material);
    if (Object.hasOwn(materials, key)) fail();
    materials[key] = descriptor;
  }
  const references = [
    component.floor?.asset,
    ...component.objects.map((o) => o.asset),
    ...component.scatters.map((o) => o.asset),
  ].filter(Boolean);
  if (
    new Set(references.map(component_reference_key)).size !==
      value.materials.length ||
    references.some(
      (ref) => !Object.hasOwn(materials, component_reference_key(ref)),
    ) ||
    used.size !== files.size
  )
    fail();
  validate_component_materials(component, materials);
  return structuredClone(value);
}

export function component_runtime_json(value) {
  const sorted = (item) =>
    Array.isArray(item)
      ? item.map(sorted)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, sorted(item[key])]),
          )
        : item;
  return JSON.stringify(sorted(validate_component_runtime(value)));
}
