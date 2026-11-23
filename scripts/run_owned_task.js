import "./configure_environment.js";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const registry = () =>
  fs
    .readdirSync(path.join(root, "servers"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const directory = path.join(root, "servers", entry.name),
        file = path.join(directory, "package.json");
      if (!fs.existsSync(file)) return [];
      const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
      return Object.entries(manifest.fracto?.commands || {}).map(
        ([name, value]) => ({
          name,
          service: entry.name,
          directory,
          ...(typeof value === "string" ? { entry: value } : value),
        }),
      );
    });

export const declared_task_services = (name) => [
  ...new Set(
    registry()
      .filter((item) => item.name === name)
      .map((item) => item.service),
  ),
];

/** Root orchestration invokes declared executables, never imports their implementation. */
export async function run_declared_task(
  name,
  args = [],
  service,
  pending = new Set(),
) {
  const matches = registry().filter(
    (item) => item.name === name && (!service || item.service === service),
  );
  if (matches.length !== 1)
    throw new Error("No unique declared service task: " + name);
  const command = matches[0],
    id = command.service + ":" + name;
  if (pending.has(id)) throw new Error("Cyclic task prerequisite");
  const chain = new Set(pending).add(id);
  for (const before of command.before || [])
    await run_declared_task(before.command, [], before.service, chain);
  const entry = path.resolve(command.directory, command.entry),
    relative = path.relative(command.directory, entry);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Invalid declared executable");
  const child = spawn(process.execPath, [entry, ...args], {
    cwd: command.directory,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
    shell: false,
  });
  const shutdown = () => child.kill("SIGTERM");
  process.once("SIGTERM", shutdown);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  process.removeListener("SIGTERM", shutdown);
  if (code !== 0)
    throw new Error("Service task failed: " + id + " (" + code + ")");
}
