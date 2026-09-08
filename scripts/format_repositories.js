/**
 * Format the UI and data-server repositories with a per-file status report.
 *
 * Usage:
 *   node scripts/format_repositories.js write
 *   node scripts/format_repositories.js check
 */

import fs from "fs/promises";
import path from "path";
import prettier from "prettier";

const ROOT = process.cwd();
const MODE = process.argv[2] || "write";
const TARGETS = [
  {
    directory: path.join(ROOT, "servers", "fracto-ui"),
    extensions: new Set([".css", ".js", ".jsx", ".json", ".md"]),
  },
  {
    directory: path.join(ROOT, "servers", "fracto-data-server"),
    extensions: new Set([".js"]),
  },
];
const IGNORED_DIRECTORIES = new Set([".git", "dist", "node_modules"]);

const collect_files = async (directory, extensions, files = []) => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const entry_path = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collect_files(entry_path, extensions, files);
    } else if (extensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(entry_path);
    }
  }
  return files;
};

const format_file = async (file_path) => {
  const source = await fs.readFile(file_path, "utf8");
  const options = (await prettier.resolveConfig(file_path)) || {};
  const formatted = await prettier.format(source, {
    ...options,
    filepath: file_path,
  });
  const changed = source.replace(/\r\n/g, "\n") !== formatted;
  const relative_path = path.relative(ROOT, file_path);
  if (MODE === "write" && changed) {
    await fs.writeFile(file_path, formatted, "utf8");
    console.log(`formatted  ${relative_path}`);
  } else if (MODE === "check" && changed) {
    console.log(`needs formatting  ${relative_path}`);
  }
  return changed;
};

if (!["check", "write"].includes(MODE)) {
  console.error(`Unknown formatting mode: ${MODE}`);
  process.exit(1);
}

const files = [];
for (const target of TARGETS) {
  await collect_files(target.directory, target.extensions, files);
}
files.sort();

let needs_formatting = false;
for (const file_path of files) {
  needs_formatting = (await format_file(file_path)) || needs_formatting;
}

if (MODE === "check" && needs_formatting) {
  process.exit(1);
}
