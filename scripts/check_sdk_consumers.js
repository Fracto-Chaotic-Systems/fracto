import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script_directory = path.dirname(fileURLToPath(import.meta.url));
const repository_root = path.resolve(script_directory, "..");
const sdk_package_path = path.join(repository_root, "sdk", "package.json");
const sdk_package = JSON.parse(fs.readFileSync(sdk_package_path, "utf8"));
const sdk_dependency = "file:../../sdk";
const consumers = [
  "servers/fracto-ui",
  "servers/fracto-data-server",
  "servers/fracto-asset-server",
  "servers/fracto-tiles-server",
];

const failures = [];
const collect_source_files = (directory) => {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }
    const entry_path = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collect_source_files(entry_path));
    } else if (/\.(js|jsx)$/.test(entry.name)) {
      files.push(entry_path);
    }
  }
  return files;
};

for (const consumer of consumers) {
  const package_path = path.join(repository_root, consumer, "package.json");
  const package_json = JSON.parse(fs.readFileSync(package_path, "utf8"));
  const dependency = package_json.dependencies?.["@fracto/sdk"];
  if (dependency !== sdk_dependency) {
    failures.push(`${consumer}: expected @fracto/sdk=${sdk_dependency}`);
  }

  const lock_path = path.join(repository_root, consumer, "package-lock.json");
  const lock_json = JSON.parse(fs.readFileSync(lock_path, "utf8"));
  const root_dependency =
    lock_json.packages?.[""].dependencies?.["@fracto/sdk"];
  const installed_package = lock_json.packages?.["node_modules/@fracto/sdk"];
  if (root_dependency !== sdk_dependency) {
    failures.push(
      `${consumer}: lockfile does not declare the local SDK dependency`,
    );
  }
  if (
    installed_package?.resolved !== "../../sdk" ||
    installed_package?.link !== true
  ) {
    failures.push(
      `${consumer}: lockfile does not resolve the local SDK package`,
    );
  }

  const consumer_root = path.join(repository_root, consumer);
  const relative_sdk_import = /from\s+["']\.\.?\/[^"']*sdk\//;
  for (const source_file of collect_source_files(consumer_root)) {
    const source = fs.readFileSync(source_file, "utf8");
    if (relative_sdk_import.test(source)) {
      failures.push(
        `${path.relative(repository_root, source_file)}: use @fracto/sdk instead of a relative SDK import`,
      );
    }
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `@fracto/sdk ${sdk_package.version} is configured in ${consumers.length} consumers`,
  );
}
