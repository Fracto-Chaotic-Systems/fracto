import {
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ADMIN_PAGE_CONFIG from "./sections/admin.js";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const VALUE_OPTIONS = new Set([
  "section",
  "name",
  "sidebar-label",
  "title",
  "scaffold",
]);
const USAGE = `Usage:
  npm run page:add -- --section admin --name <page-name> \\
    --sidebar-label "<sidebar-label>" --title "<page-title>" \\
    --scaffold title-only [--dry-run | --apply]`;

const parse_arguments = (args) => {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--dry-run") {
      if (options.dry_run) throw new Error("Duplicate option: --dry-run");
      options.dry_run = true;
      continue;
    }
    if (argument === "--apply") {
      if (options.apply) throw new Error("Duplicate option: --apply");
      options.apply = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    const key = argument.slice(2).replaceAll("-", "_");
    if (!VALUE_OPTIONS.has(argument.slice(2))) {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (Object.hasOwn(options, key)) {
      throw new Error(`Duplicate option: ${argument}`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
};

const to_upper_snake = (name) => name.replaceAll("-", "_").toUpperCase();
const to_component_case = (name, case_type) => {
  if (case_type !== "pascal") {
    throw new Error(`Unsupported component case: ${case_type}`);
  }
  return name
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
};

const validate_request = (request, config) => {
  if (request.dry_run && request.apply) {
    throw new Error("Use either --dry-run or --apply, not both.");
  }
  const required = ["section", "name", "sidebar_label", "title", "scaffold"];
  const missing = required.filter((key) => !request[key]);
  if (missing.length) {
    throw new Error(
      `Missing required options: ${missing.map((key) => `--${key.replaceAll("_", "-")}`).join(", ")}`,
    );
  }
  if (request.section !== config.section) {
    throw new Error(
      `Only the ${config.section} section is supported currently.`,
    );
  }
  for (const field of ["name", "sidebar_label", "title"]) {
    if (typeof request[field] !== "string" || !request[field].trim()) {
      throw new Error(
        `Option --${field.replaceAll("_", "-")} must not be empty.`,
      );
    }
    if (/[\r\n\0]/.test(request[field])) {
      throw new Error(
        `Option --${field.replaceAll("_", "-")} must be a single line.`,
      );
    }
  }
  if (!config.validation.page_name_pattern.test(request.name)) {
    throw new Error(
      "Page name must use lowercase kebab-case, such as server-tools.",
    );
  }
  if (!config.validation.scaffold_types.includes(request.scaffold)) {
    throw new Error(`Unsupported scaffold type: ${request.scaffold}`);
  }
};

const relative_path = (file_path, repository_root) =>
  path.join(repository_root, file_path);

const count_occurrences = (source, value) => source.split(value).length - 1;

const validate_sources = (request, derived, config, repository_root) => {
  const registry_sources = {};
  for (const [registry_name, anchors] of Object.entries(
    config.validation.source_anchors,
  )) {
    const source_path = relative_path(
      config.paths[registry_name],
      repository_root,
    );
    if (!existsSync(source_path) || !statSync(source_path).isFile()) {
      throw new Error(`Required admin source file is missing: ${source_path}`);
    }
    const source = readFileSync(source_path, "utf8");
    registry_sources[registry_name] = source;
    for (const anchor of anchors) {
      const newline = source.includes("\r\n") ? "\r\n" : "\n";
      const source_anchor = anchor.replaceAll("\n", newline);
      const count = count_occurrences(source, source_anchor);
      if (count !== 1) {
        throw new Error(
          `Expected one insertion anchor ${JSON.stringify(anchor)} in ${source_path}; found ${count}. The admin source layout may have changed.`,
        );
      }
    }
  }

  const page_directory = relative_path(
    config.paths.page_directory,
    repository_root,
  );
  if (!existsSync(page_directory) || !statSync(page_directory).isDirectory()) {
    throw new Error(`Admin page directory is missing: ${page_directory}`);
  }
  const page_file_path = path.join(page_directory, derived.page_file);
  if (existsSync(page_file_path)) {
    throw new Error(`Page file already exists: ${page_file_path}`);
  }

  const collision_checks = [
    ["settings_registry", derived.section_constant, derived.section_code],
    [
      "text_registry",
      derived.sidebar_key_name,
      derived.title_key_name,
      JSON.stringify(derived.sidebar_text_key),
      JSON.stringify(derived.title_text_key),
    ],
    ["sidebar_registry", derived.component_name],
    ["page_readme", `\`${derived.page_file}\``],
  ];
  for (const [registry_name, ...identifiers] of collision_checks) {
    const source = registry_sources[registry_name];
    const identifier = identifiers.find((candidate) =>
      source.includes(candidate),
    );
    if (identifier) {
      const source_path = relative_path(
        config.paths[registry_name],
        repository_root,
      );
      throw new Error(
        `Generated name or key ${JSON.stringify(identifier)} already exists in ${source_path}. Choose a different page name.`,
      );
    }
  }

  if (!request.sidebar_label.trim() || !request.title.trim()) {
    throw new Error("Sidebar label and page title must contain visible text.");
  }
};

const replace_anchor = (source, anchor, insertion, position = "before") => {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const actual_anchor = anchor.replaceAll("\n", newline);
  const actual_insertion = insertion.replace(/\r?\n/g, newline);
  if (count_occurrences(source, actual_anchor) !== 1) {
    throw new Error(`Expected one source insertion anchor: ${anchor}`);
  }
  return position === "after"
    ? source.replace(actual_anchor, `${actual_anchor}${actual_insertion}`)
    : source.replace(actual_anchor, `${actual_insertion}${actual_anchor}`);
};

const build_file_updates = (request, preview, config, repository_root) => {
  const derived = derive_names(request, config);
  validate_sources(request, derived, config, repository_root);
  const read_source = (registry_name) =>
    readFileSync(
      relative_path(config.paths[registry_name], repository_root),
      "utf8",
    );
  const updates = [];
  const page_change = preview.changes.find(
    (change) => change.operation === "create",
  );
  updates.push({
    path: page_change.file,
    original: null,
    content: page_change.content,
  });

  const settings_path = relative_path(
    config.paths.settings_registry,
    repository_root,
  );
  const settings_source = read_source("settings_registry");
  updates.push({
    path: settings_path,
    original: settings_source,
    content: replace_anchor(
      settings_source,
      config.validation.source_anchors.settings_registry[0],
      `${preview.changes[1].content}\n`,
    ),
  });

  const text_path = relative_path(config.paths.text_registry, repository_root);
  const text_source = read_source("text_registry");
  const text_lines = preview.changes[2].content.split("\n");
  const text_exports = `${text_lines.slice(0, 2).join("\n")}\n`;
  let text_content = replace_anchor(
    text_source,
    config.validation.source_anchors.text_registry[0],
    text_exports,
  );
  const map_open = config.validation.source_anchors.text_registry[1];
  const map_start = text_content.indexOf(map_open);
  const newline = text_content.includes("\r\n") ? "\r\n" : "\n";
  const map_close = text_content.indexOf(`${newline}};`, map_start);
  if (map_start < 0 || map_close < 0) {
    throw new Error(
      `Unable to locate the end of APP_ADMIN_TEXT in ${text_path}`,
    );
  }
  const text_values = text_lines.slice(2).join(newline);
  text_content = `${text_content.slice(0, map_close)}${newline}${text_values}${text_content.slice(map_close)}`;
  updates.push({
    path: text_path,
    original: text_source,
    content: text_content,
  });

  const sidebar_path = relative_path(
    config.paths.sidebar_registry,
    repository_root,
  );
  const sidebar_source = read_source("sidebar_registry");
  const sidebar_anchors = config.validation.source_anchors.sidebar_registry;
  const sidebar_lines = preview.changes[3].content.split("\n");
  const import_lines = sidebar_lines.slice(0, 3).join(newline);
  let sidebar_content = replace_anchor(
    sidebar_source,
    sidebar_anchors[0],
    `${newline}${import_lines}`,
    "after",
  );
  sidebar_content = replace_anchor(
    sidebar_content,
    sidebar_anchors[2],
    `${newline}${sidebar_lines.slice(3).join(newline)}`,
    "after",
  );
  updates.push({
    path: sidebar_path,
    original: sidebar_source,
    content: sidebar_content,
  });

  const readme_path = relative_path(config.paths.page_readme, repository_root);
  const readme_source = read_source("page_readme");
  const safe_title = request.title
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`");
  const readme_newline = readme_source.includes("\r\n") ? "\r\n" : "\n";
  const readme_entry = `- \`${derived.page_file}\` renders the ${safe_title} page scaffold.`;
  updates.push({
    path: readme_path,
    original: readme_source,
    content: `${readme_source.trimEnd()}${readme_newline}${readme_entry}${readme_newline}`,
  });
  return updates;
};

const apply_file_updates = (updates) => {
  const transaction_id = randomUUID();
  const staged = updates.map((update, index) => ({
    ...update,
    temporary_path: `${update.path}.page-scaffold-${transaction_id}-${index}.tmp`,
    backup_path: `${update.path}.page-scaffold-${transaction_id}-${index}.bak`,
    backed_up: false,
    installed: false,
  }));

  try {
    for (const update of staged) {
      if (existsSync(update.temporary_path) || existsSync(update.backup_path)) {
        throw new Error(
          `Temporary scaffold file already exists beside ${update.path}`,
        );
      }
      writeFileSync(update.temporary_path, update.content, { flag: "wx" });
    }
    for (const update of staged) {
      const target_exists = existsSync(update.path);
      if (update.original === null && target_exists) {
        throw new Error(`Page file appeared during generation: ${update.path}`);
      }
      if (update.original !== null) {
        if (
          !target_exists ||
          readFileSync(update.path, "utf8") !== update.original
        ) {
          throw new Error(
            `Admin source changed during generation: ${update.path}`,
          );
        }
        renameSync(update.path, update.backup_path);
        update.backed_up = true;
      }
      renameSync(update.temporary_path, update.path);
      update.installed = true;
    }
  } catch (error) {
    for (const update of staged.slice().reverse()) {
      if (update.installed && existsSync(update.path)) unlinkSync(update.path);
      if (update.backed_up && existsSync(update.backup_path)) {
        renameSync(update.backup_path, update.path);
      }
      if (existsSync(update.temporary_path)) unlinkSync(update.temporary_path);
    }
    throw error;
  }

  for (const update of staged) {
    if (update.backed_up) unlinkSync(update.backup_path);
  }
};

export const apply_page_preview = (
  request,
  preview,
  { repository_root = REPOSITORY_ROOT, config = ADMIN_PAGE_CONFIG } = {},
) => {
  if (!request.apply || request.dry_run) {
    throw new Error(
      "Applying a scaffold requires the explicit --apply option.",
    );
  }
  repository_root = path.resolve(repository_root);
  const updates = build_file_updates(request, preview, config, repository_root);
  apply_file_updates(updates);
  return updates.map((update) => update.path);
};

const derive_names = (request, config) => {
  const name_constant = to_upper_snake(request.name);
  const component_name = `${config.naming.component_prefix}${to_component_case(request.name, config.naming.component_case)}`;
  const section_code = `${config.naming.section_code_prefix}${request.name.replaceAll("-", config.naming.section_code_separator)}`;
  const section_constant = section_code.toUpperCase();
  const sidebar_key_name = `${config.naming.text_key_constant_prefix}${name_constant}`;
  const title_key_name = `${sidebar_key_name}${config.naming.title_text_key_constant_suffix}`;
  const sidebar_text_key = `${config.naming.sidebar_text_key_prefix}${request.name}`;
  const title_text_key = `${sidebar_text_key}${config.naming.title_text_key_suffix}`;
  return {
    component_name,
    page_file: `${component_name}.jsx`,
    section_constant,
    section_code,
    sidebar_key_name,
    sidebar_text_key,
    title_key_name,
    title_text_key,
  };
};

export const create_page_preview = (
  request,
  { repository_root = REPOSITORY_ROOT, config = ADMIN_PAGE_CONFIG } = {},
) => {
  repository_root = path.resolve(repository_root);
  validate_request(request, config);

  const derived = derive_names(request, config);
  validate_sources(request, derived, config, repository_root);
  const {
    component_name,
    page_file,
    section_constant,
    section_code,
    sidebar_key_name,
    sidebar_text_key,
    title_key_name,
    title_text_key,
  } = derived;
  const title_template = config.templates[request.scaffold];
  const component_source = title_template({
    component_name,
    title_text_key: { export_name: title_key_name },
  });

  return {
    request: {
      section: request.section,
      name: request.name,
      sidebar_label: request.sidebar_label,
      title: request.title,
      scaffold: request.scaffold,
      dry_run: Boolean(request.dry_run),
      apply: Boolean(request.apply),
    },
    changes: [
      {
        file: relative_path(
          `${config.paths.page_directory}/${page_file}`,
          repository_root,
        ),
        operation: "create",
        content: component_source,
      },
      {
        file: relative_path(config.paths.settings_registry, repository_root),
        operation: "add admin section constant",
        content: `export const ${section_constant} = "${section_code}";`,
      },
      {
        file: relative_path(config.paths.text_registry, repository_root),
        operation: "add AppText keys and values",
        content: [
          `export const ${sidebar_key_name} = ${JSON.stringify(sidebar_text_key)};`,
          `export const ${title_key_name} = ${JSON.stringify(title_text_key)};`,
          `  [${sidebar_key_name}]: ${JSON.stringify(request.sidebar_label)},`,
          `  [${title_key_name}]: ${JSON.stringify(request.title)},`,
        ].join("\n"),
      },
      {
        file: relative_path(config.paths.sidebar_registry, repository_root),
        operation: "register admin sidebar page",
        content: [
          `import { ${section_constant} } from "../settings/AdminSettings.jsx";`,
          `import { ${sidebar_key_name} } from "../text/AdminText.jsx";`,
          `import ${component_name} from "./admin/${page_file}";`,
          "  {",
          `    title_key: ${sidebar_key_name},`,
          `    section_code: ${section_constant},`,
          `    right_pane: <${component_name} />,`,
          "  },",
        ].join("\n"),
      },
      {
        file: relative_path(config.paths.page_readme, repository_root),
        operation: "document the new admin page",
        content: `- \`${page_file}\` renders the ${request.title} page scaffold.`,
      },
    ],
  };
};

const main = () => {
  try {
    const request = parse_arguments(process.argv.slice(2));
    const preview = create_page_preview(request);
    console.log("Admin page scaffold preview:");
    for (const change of preview.changes) {
      console.log(`\n${change.operation.toUpperCase()}: ${change.file}`);
      console.log(change.content);
    }
    if (preview.request.dry_run) {
      console.log("\nDry run complete; no files were changed.");
    } else if (preview.request.apply) {
      const written_files = apply_page_preview(request, preview);
      console.log("\nCreated admin page scaffold:");
      for (const file of written_files) console.log(`  ${file}`);
    } else {
      console.log("\nPreview complete; pass --apply to write these changes.");
    }
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    process.exitCode = 1;
  }
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
