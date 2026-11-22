import fs from "node:fs";
import path from "node:path";

// Root-owned deployment configuration is passed as environment, never imported by consumers.
const root = path.resolve(import.meta.dirname, "..");
process.env.FRACTO_WORKSPACE_DIR ||= root;
if (!process.env.FRACTO_TILE_REMOTE_BASE_URL) {
  const file = path.join(root, "config/network.json");
  if (fs.existsSync(file)) {
    const network = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof network["fracto-prod"] === "string")
      process.env.FRACTO_TILE_REMOTE_BASE_URL = network["fracto-prod"];
  }
}
