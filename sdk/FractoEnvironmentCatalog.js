// Pure contracts shared by asset storage and database services. No I/O or SQL.
export function normalize_model_folder(value = "") {
  if (
    typeof value !== "string" ||
    value.length > 512 ||
    value.includes(":") ||
    value.includes(String.fromCharCode(92)) ||
    [...value].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    fail("invalid_folder");
  const trimmed = value.trim();
  if (!trimmed) return "";
  const parts = trimmed.split("/").map((part) => part.trim());
  if (
    parts.length > 8 ||
    parts.some(
      (part) => !part || part === "." || part === ".." || part.length > 64,
    )
  )
    fail("invalid_folder");
  return parts.join("/");
}

export const MODEL_CATEGORY_DIRECTORIES = {
  material: "ingredients",
  component: "composites",
  area: "environments",
};
export function validate_model_category(value = "material") {
  if (
    typeof value !== "string" ||
    !Object.hasOwn(MODEL_CATEGORY_DIRECTORIES, value)
  )
    fail();
  return value;
}
export function model_category_from_path(relative) {
  return (
    Object.keys(MODEL_CATEGORY_DIRECTORIES).find(
      (category) =>
        MODEL_CATEGORY_DIRECTORIES[category] ===
        relative.replaceAll("\\", "/").split("/")[0],
    ) || "material"
  );
}

export function validate_model_asset_page(page, category) {
  const id = (value) =>
    typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value);
  if (
    !page ||
    !Array.isArray(page.assets) ||
    page.assets.length > 200 ||
    !(page.next_cursor === null || id(page.next_cursor))
  )
    fail();
  for (const asset of page.assets) {
    if (asset) normalize_model_folder(asset.folder_path);
    if (
      !asset ||
      !id(asset.id) ||
      typeof asset.name !== "string" ||
      asset.name.length > 255 ||
      typeof asset.category !== "string" ||
      !Object.hasOwn(MODEL_CATEGORY_DIRECTORIES, asset.category) ||
      (category && asset.category !== category) ||
      !(
        asset.model === null ||
        (typeof asset.model === "string" && asset.model.length <= 4096)
      ) ||
      !(
        asset.format === null ||
        (typeof asset.format === "string" && asset.format.length <= 16)
      )
    )
      fail();
  }
  return page;
}
export const CATALOG_FIELDS = [
  "creator_name",
  "creator_profile_url",
  "source_url",
  "license_name",
  "license_file",
  "credit_text",
  "modification_conditions",
  "redistribution_conditions",
  "notes",
];
const fail = (code = "invalid_record") => {
  throw Object.assign(new Error(code), { status: 400 });
};

export function catalog_view(record) {
  return {
    schema_version: 1,
    id: record.id,
    version: record.version,
    name: record.name,
    description: record.description,
    folder_path: normalize_model_folder(record.folder_path),
    attribution: Object.fromEntries(
      ["status", ...CATALOG_FIELDS].map((field) => [
        field,
        typeof record.attribution?.[field] === "string"
          ? record.attribution[field]
          : null,
      ]),
    ),
    sources: (record.sources || []).map(({ path, format }) => ({
      path,
      format,
    })),
    history: (record.history || []).map(({ date, action, description }) => ({
      date,
      action,
      description,
    })),
  };
}

export function validate_catalog_edit(body) {
  if (
    !body ||
    Object.keys(body).some(
      (key) =>
        !["revision", "attribution", "note", "folder_path"].includes(key),
    ) ||
    !/^[a-f0-9]{64}$/.test(body.revision) ||
    !body.attribution ||
    typeof body.attribution !== "object" ||
    Array.isArray(body.attribution) ||
    Object.keys(body.attribution).some(
      (key) => !CATALOG_FIELDS.includes(key),
    ) ||
    CATALOG_FIELDS.some((key) => !Object.hasOwn(body.attribution, key)) ||
    typeof body.note !== "string" ||
    body.note.length > 10000
  )
    fail();
  const attribution = {};
  for (const field of CATALOG_FIELDS) {
    const value = body.attribution[field];
    if (value != null && (typeof value !== "string" || value.length > 10000))
      fail();
    attribution[field] = value?.trim() || null;
    if (attribution[field] && field.endsWith("_url")) {
      try {
        if (!["http:", "https:"].includes(new URL(attribution[field]).protocol))
          fail("invalid_url");
      } catch {
        fail("invalid_url");
      }
    }
  }
  return {
    attribution,
    note: body.note.trim(),
    ...(Object.hasOwn(body, "folder_path")
      ? { folder_path: normalize_model_folder(body.folder_path) }
      : {}),
  };
}

// Do not transmit source machine paths or arbitrary record extensions.
export function environment_registration(record, revision) {
  return {
    record: {
      ...catalog_view(record),
      category: record.category || "environment",
      model_category: validate_model_category(record.model_category),
      parent_id: record.parent_id || null,
      sources: (record.sources || []).map(({ path, format, sha256 }) => ({
        path,
        format,
        sha256,
      })),
      runtime: {
        path: record.runtime?.path || null,
        format: record.runtime?.format || null,
      },
    },
    revision,
  };
}

export function validate_environment_registration(body) {
  const record = body?.record;
  const text = (value, max, nullable = false) =>
    (nullable && value === null) ||
    (typeof value === "string" && value.length <= max);
  const keys = (object, allowed) =>
    object &&
    typeof object === "object" &&
    !Array.isArray(object) &&
    Object.keys(object).every((key) => allowed.includes(key));
  if (
    !keys(body, ["record", "revision"]) ||
    !/^[a-f0-9]{64}$/.test(body.revision) ||
    !keys(record, [
      "schema_version",
      "id",
      "version",
      "name",
      "description",
      "folder_path",
      "category",
      "model_category",
      "parent_id",
      "attribution",
      "sources",
      "runtime",
      "history",
    ]) ||
    record.schema_version !== 1 ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(record.id) ||
    !text(record.version, 64) ||
    !text(record.name, 255) ||
    !text(record.description, 10000, true) ||
    !text(record.category, 64) ||
    (record.model_category !== undefined &&
      (typeof record.model_category !== "string" ||
        !Object.hasOwn(MODEL_CATEGORY_DIRECTORIES, record.model_category))) ||
    !(
      record.parent_id === null ||
      /^[a-z][a-z0-9-]{0,63}$/.test(record.parent_id)
    ) ||
    !keys(record.attribution, ["status", ...CATALOG_FIELDS]) ||
    !text(record.attribution.status, 64, true) ||
    !keys(record.runtime, ["path", "format"]) ||
    !text(record.runtime.path, 4096, true) ||
    !text(record.runtime.format, 16, true) ||
    !Array.isArray(record.sources) ||
    record.sources.length > 2048 ||
    record.sources.some(
      (source) =>
        !keys(source, ["path", "format", "sha256"]) ||
        !text(source.path, 4096) ||
        !text(source.format, 32) ||
        !/^[a-f0-9]{64}$/.test(source.sha256),
    ) ||
    !Array.isArray(record.history) ||
    record.history.length > 10000 ||
    record.history.some(
      (entry) =>
        !keys(entry, ["date", "action", "description"]) ||
        !text(entry.date, 32) ||
        !text(entry.action, 128) ||
        !text(entry.description, 10000),
    )
  )
    fail();
  normalize_model_folder(record.folder_path);
  validate_catalog_edit({
    revision: body.revision,
    attribution: Object.fromEntries(
      CATALOG_FIELDS.map((key) => [key, record.attribution[key]]),
    ),
    note: "",
  });
  return body;
}
