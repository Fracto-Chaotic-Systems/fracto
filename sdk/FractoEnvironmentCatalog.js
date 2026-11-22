// Pure contracts shared by asset storage and database services. No I/O or SQL.
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
      (key) => !["revision", "attribution", "note"].includes(key),
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
  return { attribution, note: body.note.trim() };
}

// Do not transmit source machine paths or arbitrary record extensions.
export function environment_registration(record, revision) {
  return {
    record: {
      ...catalog_view(record),
      category: record.category || "environment",
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
      "category",
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
  validate_catalog_edit({
    revision: body.revision,
    attribution: Object.fromEntries(
      CATALOG_FIELDS.map((key) => [key, record.attribution[key]]),
    ),
    note: "",
  });
  return body;
}
