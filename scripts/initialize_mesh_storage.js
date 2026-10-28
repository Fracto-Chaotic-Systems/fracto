import path from "node:path";
import {
  initialize_mesh_storage,
  MESH_DIRECTORY,
  MESH_LAYOUT,
} from "../sdk/terrain/Paths.js";

// An explicit host tile directory supports preparing a nested writable bind
// before the service starts with the numerical source mounted read-only.
const args = process.argv.slice(2);
const options = { root: MESH_DIRECTORY, layout: MESH_LAYOUT };
for (let i = 0; i < args.length; i += 2) {
  if (args[i] === "--tiles-directory" && args[i + 1])
    options.root = path.join(path.resolve(args[i + 1]), "meshes");
  else if (args[i] === "--layout" && args[i + 1]) options.layout = args[i + 1];
  else
    throw new Error(
      "Usage: initialize_mesh_storage.js [--tiles-directory PATH] [--layout level|shortcode]",
    );
}
console.log(JSON.stringify(await initialize_mesh_storage(options)));
