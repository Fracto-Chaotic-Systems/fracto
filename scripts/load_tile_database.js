import { run_declared_task } from "./run_owned_task.js";

await run_declared_task("load_tile_database", process.argv.slice(2));
