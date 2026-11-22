import path from "node:path";
import {run_declared_task}from"./run_owned_task.js";
await run_declared_task(path.basename(import.meta.filename,".js"),process.argv.slice(2));
