import {
  normalize_model_folder,
  validate_model_category,
} from "./FractoEnvironmentCatalog.js";

const fail = () => {
  throw new Error("invalid_record");
};
export const folder_contains = (parent, path) =>
  path === parent || path.startsWith(parent + "/");
export function normalize_model_name(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 255 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    fail();
  return value.trim();
}
export function validate_model_management(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail();
  const folder = ["rename-folder", "delete-folder", "move-folder"].includes(
    body.action,
  );
  if (!folder && !["rename-model", "delete-model"].includes(body.action))
    fail();
  const allowed = folder
    ? [
        "action",
        "category",
        "folder_path",
        ...(body.action === "rename-folder" ? ["name"] : []),
        ...(body.action === "move-folder" ? ["parent"] : []),
      ]
    : [
        "action",
        "id",
        "revision",
        ...(body.action === "rename-model" ? ["name"] : []),
      ];
  if (Object.keys(body).some((key) => !allowed.includes(key))) fail();
  if (folder) {
    if (typeof body.category !== "string") fail();
    validate_model_category(body.category);
    const folder_path = normalize_model_folder(body.folder_path);
    if (!folder_path) fail();
    if (body.action === "delete-folder") return { ...body, folder_path };
    if (body.action === "move-folder") {
      // Moves keep the folder's own name under a new parent ("" is the root).
      if (typeof body.parent !== "string") fail();
      const parent = normalize_model_folder(body.parent);
      const name = folder_path.split("/").at(-1);
      const target = normalize_model_folder(
        parent ? `${parent}/${name}` : name,
      );
      if (target !== folder_path && folder_contains(folder_path, parent))
        throw new Error("invalid_folder");
      return { ...body, folder_path, parent, target };
    }
    const name = normalize_model_folder(body.name);
    if (!name || name.includes("/")) fail();
    const parts = folder_path.split("/");
    parts.pop();
    parts.push(name);
    return {
      ...body,
      folder_path,
      name,
      target: normalize_model_folder(parts.join("/")),
    };
  }
  if (
    typeof body.id !== "string" ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(body.id) ||
    typeof body.revision !== "string" ||
    !/^[a-f0-9]{64}$/.test(body.revision)
  )
    fail();
  return {
    ...body,
    ...(body.action === "rename-model"
      ? { name: normalize_model_name(body.name) }
      : {}),
  };
}
