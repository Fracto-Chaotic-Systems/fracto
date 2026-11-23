import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { declared_task_services, run_declared_task } from "./run_owned_task.js";
import { run_managed_production } from "./managed_production.js";
import { configuration_mounts, MOUNT_CONTRACT } from "./managed_mounts.js";
import { install_managed_mount_adapter } from "./managed_controller_adapter.js";
import {
  managed_docker,
  recover_managed_production,
  with_managed_recovery_lock,
} from "./managed_recovery.js";

const ROOT = path.resolve(import.meta.dirname, "..");
async function check_service_configuration() {
  for (const service of declared_task_services("startup_check"))
    await run_declared_task("startup_check", [], service);
}

/** Host configuration is checked by its service; Docker metadata stays in orchestration. */
export async function cold_boot_preflight({
  root = ROOT,
  mode = "prod",
  run = spawnSync,
  check_services = check_service_configuration,
  docker = managed_docker(root, run),
  rollback = () => run_managed_production({ root, action: "rollback" }),
  log = console.log,
} = {}) {
  if (!["prod", "dev"].includes(mode)) throw Error("Expected prod or dev mode");
  await check_services();
  const args = ["compose", "-f", "compose.yaml"];
  if (mode === "dev") args.push("-f", "compose.dev.yaml");
  args.push("config", "--format", "json");
  const response = run("docker", args, {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 16 * 1024 ** 2,
    windowsHide: true,
    shell: false,
  });
  if (response.error || response.status !== 0)
    throw Error(
      "Could not resolve deployment settings; run docker compose config to diagnose",
    );
  let configuration;
  try {
    configuration = JSON.parse(response.stdout);
  } catch {
    throw Error("Docker Compose returned invalid deployment settings");
  }
  if (!configuration.services?.fracto)
    throw Error("Production Compose service is missing");
  // Inspect only deployment paths; service implementations validate their contents.
  configuration_mounts(configuration, root);
  if (!fs.existsSync(path.join(root, ".fracto-production.json"))) {
    log("Deployment configuration checks passed.");
    return;
  }
  return with_managed_recovery_lock(root, () => {
    const current = recover_managed_production({
      root,
      mode,
      docker,
      rollback,
      log,
    });
    if (mode === "dev") return;
    const mounts = configuration_mounts(configuration, root, current);
    const installed = install_managed_mount_adapter(root);
    const contract = path.join(root, MOUNT_CONTRACT),
      temporary = contract + "." + randomUUID() + ".tmp";
    try {
      fs.writeFileSync(
        temporary,
        JSON.stringify({ schema_version: 1, mounts }, null, 2) + "\n",
        { flag: "wx" },
      );
      fs.renameSync(temporary, contract);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    if (installed)
      log(
        "Installed the configuration-mount adapter; the original managed controller was backed up.",
      );
    log("Managed recovery and required configuration-mount checks passed.");
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    await cold_boot_preflight({ mode: process.argv[2] || "prod" });
  } catch (error) {
    console.error(`Cold boot preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}
