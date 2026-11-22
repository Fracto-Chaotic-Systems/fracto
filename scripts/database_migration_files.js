import fs from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../constants.js";

// The runner owns ordering/history, while each service owns its application DDL.
// A test/deployment override is exclusive, preserving isolated migration fixtures.
export function database_migration_files({
  root = ROOT_DIR,
  override = process.env.FRACTO_DB_MIGRATION_DIR,
} = {}) {
  const directories = override
    ? [path.resolve(override)]
    : [path.join(root, "database/migrations")];
  if (!override) {
    const services = path.join(root, "servers");
    if (fs.existsSync(services))
      for (const entry of fs.readdirSync(services, { withFileTypes: true })) {
        const directory = path.join(
          services,
          entry.name,
          "database/migrations",
        );
        if (entry.isDirectory() && fs.existsSync(directory))
          directories.push(directory);
      }
  }
  const files = new Map(),
    versions = new Set();
  for (const directory of directories)
    for (const filename of fs
      .readdirSync(directory)
      .filter((name) => name.endsWith(".sql"))) {
      const version = filename.match(/^(\d{3,})_[A-Za-z0-9-]+\.sql$/)?.[1];
      if (!version) throw new Error(`Invalid migration filename: ${filename}`);
      if (versions.has(version))
        throw new Error(`Duplicate migration version: ${version}`);
      versions.add(version);
      files.set(filename, path.join(directory, filename));
    }
  return new Map([...files].sort(([a], [b]) => a.localeCompare(b)));
}
