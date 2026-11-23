// Shared browser/server import validation; callers supply their ZIP decoder.
export const ASSET_IMPORT_LIMIT = 100 * 1024 * 1024;
export const ASSET_FILE_LIMIT = 2000;
export const MODEL_FORMATS = ["glb", "gltf", "fbx", "obj", "3ds", "blend"];
const fail = (code) => {
  throw new Error(code);
};
export function asset_relative_path(value) {
  const name = value.replaceAll("\\", "/");
  const parts = name.split("/");
  if (
    !name ||
    name.length > 500 ||
    /[\x00-\x1f:]/.test(name) ||
    parts.some(
      (part) =>
        !part ||
        [".", "..", "__proto__", "prototype", "constructor"].includes(part) ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  )
    fail("unsafe_path");
  return name;
}
export const asset_format = (file) => file.split(".").at(-1).toLowerCase();
export const ignored_asset_file = (name) =>
  name
    .split(/[\\/]/)
    .some((part) =>
      [".git", "node_modules", "__MACOSX", ".DS_Store", "Thumbs.db"].includes(
        part,
      ),
    );

export function bounded_unzip(data, unzip) {
  let bytes = 0,
    count = 0;
  const names = new Set();
  return unzip(data, {
    filter(entry) {
      if (entry.name.endsWith("/")) return false;
      asset_relative_path(entry.name);
      const key = entry.name.toLowerCase();
      if (names.has(key)) fail("duplicate_path");
      names.add(key);
      bytes += entry.originalSize;
      if (++count > ASSET_FILE_LIMIT || bytes > ASSET_IMPORT_LIMIT)
        fail("import_too_large");
      return true;
    },
  });
}

export function asset_model_paths(entries, { allow_empty = false } = {}) {
  const models = entries
    .filter((file) => MODEL_FORMATS.includes(asset_format(file.path)))
    .map((file) => asset_relative_path(file.path))
    .sort(
      (a, b) =>
        MODEL_FORMATS.indexOf(asset_format(a)) -
          MODEL_FORMATS.indexOf(asset_format(b)) || a.localeCompare(b),
    );
  if (!models.length && !allow_empty) fail("no_model");
  return models;
}

export function expand_asset_files(
  files,
  unzip,
  { allow_no_model = false } = {},
) {
  const entries = [],
    names = new Set();
  let total = 0;
  const add = (name, data, original, depth) => {
    if (ignored_asset_file(name)) return;
    const file = asset_relative_path(name),
      key = file.toLowerCase();
    if (names.has(key)) fail("duplicate_path");
    names.add(key);
    total += data.byteLength;
    if (entries.length >= ASSET_FILE_LIMIT || total > ASSET_IMPORT_LIMIT)
      fail("import_too_large");
    entries.push({ path: file, data, original });
    if (asset_format(file) === "zip") {
      if (depth >= 2) fail("archive_depth");
      const base = original
        ? `source/extracted/${file.slice("source/files/".length, -4)}`
        : `${file.slice(0, -4)}.contents`;
      for (const [relative, bytes] of Object.entries(
        bounded_unzip(data, unzip),
      )) {
        add(`${base}/${relative}`, bytes, false, depth + 1);
      }
    }
  };
  for (const file of files)
    add(`source/files/${asset_relative_path(file.path)}`, file.data, true, 0);
  const models = asset_model_paths(entries, { allow_empty: allow_no_model });
  return { entries, models };
}
