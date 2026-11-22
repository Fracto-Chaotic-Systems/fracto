const fail = () => {
  throw new Error("INVALID_FEATURE_CATALOG");
};
const shape = (value, keys) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key))
  )
    fail();
};
const string = (value, max = 600) => {
  if (typeof value !== "string" || !value.trim() || value.length > max) fail();
};
const id = (value) => {
  string(value, 64);
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)) fail();
};
const list = (value, max, min = 0) => {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail();
};
const unique = (values) => {
  if (new Set(values).size !== values.length) fail();
};
const source_path = (value) => {
  string(value, 240);
  if (
    !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*\.(jsx?|json|md|ya?ml)$/.test(
      value,
    ) ||
    value
      .split("/")
      .some((part) =>
        [
          "runtime",
          "logs",
          "config",
          "node_modules",
          "dist",
          "secrets",
        ].includes(part.toLowerCase()),
      )
  )
    fail();
};
const reference = (entry) => {
  shape(entry, ["repository", "path"]);
  if (
    !["main", "ui", "ai", "admin", "data", "assets", "tiles"].includes(
      entry.repository,
    )
  )
    fail();
  source_path(entry.path);
};
const text_binding = (entry) => {
  shape(entry, ["key", "text", "source"]);
  if (entry.key !== null) string(entry.key, 160);
  string(entry.text, 160);
  source_path(entry.source);
};
const setting = (entry) => {
  shape(entry, ["key", "source"]);
  string(entry.key, 160);
  source_path(entry.source);
};
const strings = (entries, max = 12) => {
  list(entries, max);
  entries.forEach((entry) => string(entry));
  unique(entries);
};

/** Structured reference data only: no source reads, runtime values or UI effects. */
export const validate_catalog = (catalog) => {
  shape(catalog, [
    "contract_version",
    "catalog_id",
    "catalog_version",
    "access_profiles",
    "areas",
    "features",
  ]);
  if (
    catalog.contract_version !== 1 ||
    catalog.catalog_id !== "fracto-ui" ||
    typeof catalog.catalog_version !== "string" ||
    !/^(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})$/.test(
      catalog.catalog_version,
    )
  )
    fail();
  list(catalog.access_profiles, 16, 1);
  list(catalog.areas, 16, 1);
  list(catalog.features, 256, 1);
  unique(catalog.access_profiles.map((entry) => entry?.id));
  unique(catalog.areas.map((entry) => entry?.id));
  unique(catalog.areas.map((entry) => entry?.route));
  unique(catalog.features.map((entry) => entry?.id));
  for (const profile of catalog.access_profiles) {
    shape(profile, ["id", "description", "sources"]);
    id(profile.id);
    string(profile.description);
    list(profile.sources, 8, 1);
    profile.sources.forEach(reference);
  }
  for (const area of catalog.areas) {
    shape(area, [
      "id",
      "route",
      "component",
      "label",
      "selection_key",
      "settings_source",
    ]);
    id(area.id);
    if (area.route !== "/" && !/^\/[a-z]+$/.test(area.route)) fail();
    source_path(area.component);
    text_binding(area.label);
    if ((area.selection_key === null) !== (area.settings_source === null))
      fail();
    if (area.selection_key !== null) {
      string(area.selection_key, 160);
      source_path(area.settings_source);
    }
  }
  const areas = new Map(catalog.areas.map((area) => [area.id, area]));
  const features = new Set(catalog.features.map((feature) => feature.id));
  const profiles = new Set(
    catalog.access_profiles.map((profile) => profile.id),
  );
  for (const feature of catalog.features) {
    shape(feature, [
      "id",
      "area",
      "section",
      "component",
      "label",
      "title",
      "settings",
      "availability",
      "purpose",
      "inputs",
      "access",
      "environment",
      "limitations",
      "related_features",
      "sources",
    ]);
    id(feature.id);
    if (!areas.has(feature.area) || !profiles.has(feature.access)) fail();
    if (feature.section !== null) string(feature.section, 100);
    if (feature.component !== null) source_path(feature.component);
    text_binding(feature.label);
    if (feature.title !== null) text_binding(feature.title);
    list(feature.settings, 64);
    feature.settings.forEach(setting);
    unique(feature.settings.map((entry) => entry.key));
    if (!["implemented", "placeholder", "empty"].includes(feature.availability))
      fail();
    if (feature.availability !== "empty" && !feature.component) fail();
    if (feature.availability === "empty" && feature.component !== null) fail();
    string(feature.purpose);
    strings(feature.inputs);
    strings(feature.limitations);
    if (feature.availability !== "implemented" && !feature.limitations.length)
      fail();
    list(feature.environment, 24);
    unique(feature.environment.map((entry) => entry.name));
    for (const entry of feature.environment) {
      shape(entry, ["name", "repository", "path"]);
      reference({ repository: entry.repository, path: entry.path });
      if (!/^(?:VITE_)?FRACTO_[A-Z0-9_]+$/.test(entry.name)) fail();
    }
    strings(feature.related_features, 16);
    if (
      feature.related_features.some(
        (related) => related === feature.id || !features.has(related),
      )
    )
      fail();
    list(feature.sources, 16, 1);
    feature.sources.forEach(reference);
  }
  for (const area of catalog.areas) {
    const entries = catalog.features.filter(
      (feature) => feature.area === area.id,
    );
    if (!entries.length) fail();
    unique(entries.map((feature) => feature.section));
  }
  if (new TextEncoder().encode(JSON.stringify(catalog)).length > 262144) fail();
  return catalog;
};
