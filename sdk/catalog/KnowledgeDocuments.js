import { validate_catalog } from "./CatalogContract.js";

const text = (value) =>
  String(value)
    .replace(/\\/g, "\\\\")
    .replace(/[\r\n]+/g, " ")
    .replace(/[<>`*{}[\]#|]/g, "\\$&");
const bullets = (items, fallback = "None declared.") =>
  items.length
    ? items.map((item) => `- ${text(item)}`).join("\n")
    : `- ${fallback}`;
const location = (source) => `${source.repository}:${source.path}`;

/** Reviewed, pure ui-catalog/1.0.0 extractor. Inputs contain declared text only. */
export const extract_ui_catalog = async ({ sources, signal }) => {
  signal?.throwIfAborted();
  if (
    !Array.isArray(sources) ||
    sources.length !== 1 ||
    sources[0].id !== "catalog"
  )
    throw new Error("INVALID_UI_CATALOG_SOURCE");
  const catalog = validate_catalog(JSON.parse(sources[0].text));
  return [...catalog.areas]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((area) => {
      signal?.throwIfAborted();
      const features = catalog.features.filter(
        (feature) => feature.area === area.id,
      );
      const profiles = [...new Set(features.map((feature) => feature.access))]
        .sort()
        .map((id) =>
          catalog.access_profiles.find((profile) => profile.id === id),
        );
      const sections = [
        `# Fracto UI: ${text(area.label.text)}`,
        `## Purpose\n\nReference for the ${text(area.label.text)} area at ${text(area.route)}. Catalog ${text(catalog.catalog_id)} version ${text(catalog.catalog_version)}.`,
        `Menu label: ${text(area.label.text)}. Area ID: ${text(area.id)}. Component: ${text(area.component)}.`,
        "## Features",
        ...features.map((feature) =>
          [
            `### ${text(feature.label.text)} (${text(feature.id)})`,
            `Page title: ${text(feature.title?.text || "No static page title declared.")}`,
            `Implementation state: ${text(feature.availability)}.`,
            `Navigation: ${text(area.label.text)} > ${text(feature.label.text)}. Route: ${text(area.route)}. Section: ${text(feature.section || "home")}.`,
            `Purpose: ${text(feature.purpose)}`,
            `Inputs:\n${bullets(feature.inputs)}`,
            `Access profile: ${text(feature.access)}.`,
            `Related features:\n${bullets(feature.related_features)}`,
            `Owning sources:\n${bullets(feature.sources.map(location))}`,
          ].join("\n\n"),
        ),
        "## Permissions",
        ...profiles.map(
          (profile) =>
            `### ${text(profile.id)}\n\n${text(profile.description)}\n\nPolicy references:\n${bullets(profile.sources.map(location))}`,
        ),
        "## Configuration",
        `Area selection setting: ${text(area.selection_key || "None; home entry.")}`,
        ...features.map((feature) =>
          [
            `### ${text(feature.id)}`,
            `Browser setting names (direct panel imports):\n${bullets(feature.settings.map((entry) => `${entry.key} — ui:${entry.source}`))}`,
            `Environment variable names (values excluded):\n${bullets(feature.environment.map((entry) => `${entry.name} — ${location(entry)}`))}`,
          ].join("\n\n"),
        ),
        "## Limitations",
        "This is reviewed reference information, not live verification. Source references identify ownership; they do not imply those files were ingested. Access is enforced by the application. Nested panels may have additional controls and preferences.",
        ...features.map(
          (feature) =>
            `### ${text(feature.id)}\n\n${bullets(feature.limitations)}`,
        ),
      ];
      return {
        id: area.id,
        source_ids: ["catalog"],
        text: sections.join("\n\n") + "\n",
      };
    });
};
