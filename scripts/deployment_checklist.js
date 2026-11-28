// Collects per-asset `deployment_todo` items from the model library and checks that
// each one appears in deploy/DEPLOYMENT_CHECKLIST.md, so none is missed at deploy time.
//   node scripts/deployment_checklist.js            report open items; exit 1 if any are unlisted
// A checklist line lists an asset item as: - [ ] `asset-id` · todo-id — description
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(import.meta.dirname, "..");
export const CHECKLIST_PATH = path.join(
  ROOT,
  "deploy",
  "DEPLOYMENT_CHECKLIST.md",
);
export const models_directory = () =>
  process.env.FRACTO_ENVIRONMENT_CATALOG_DIR ||
  path.join(ROOT, "servers", "fracto-asset-server", "models");

/** Every `deployment_todo` entry from the catalog's asset records. */
export function collect_deployment_todos(directory = models_directory()) {
  const catalog = JSON.parse(
    fs.readFileSync(path.join(directory, "catalog.json"), "utf8"),
  );
  const todos = [];
  for (const { id, record } of catalog.assets) {
    const data = JSON.parse(
      fs.readFileSync(path.join(directory, record), "utf8"),
    );
    for (const todo of data.deployment_todo || []) {
      if (typeof todo?.id !== "string" || typeof todo?.item !== "string")
        throw new Error(`Invalid deployment_todo in ${record}`);
      todos.push({
        asset: id,
        id: todo.id,
        item: todo.item,
        added: todo.added ?? null,
      });
    }
  }
  return todos;
}

const line_for = (lines, todo) =>
  lines.find(
    (line) =>
      /^\s*- \[[ xX]\]/.test(line) &&
      line.includes(`\`${todo.asset}\``) &&
      new RegExp(`(^|[^a-z0-9-])${todo.id}([^a-z0-9-]|$)`).test(line),
  );

/** Compares record items with the checklist text. */
export function check_checklist(text, todos) {
  const lines = text.split(/\r?\n/);
  const missing = [],
    checked_but_open = [];
  for (const todo of todos) {
    const line = line_for(lines, todo);
    if (!line) missing.push(todo);
    else if (/^\s*- \[[xX]\]/.test(line)) checked_but_open.push(todo);
  }
  const open_lines = lines.filter((line) => /^\s*- \[ \]/.test(line));
  return { missing, checked_but_open, open: open_lines.length };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const todos = collect_deployment_todos();
  const result = check_checklist(
    fs.readFileSync(CHECKLIST_PATH, "utf8"),
    todos,
  );
  console.log(
    `Deployment checklist: ${result.open} open item(s); ${todos.length} asset record item(s).`,
  );
  for (const todo of result.checked_but_open)
    console.log(
      `Checked off but still in ${todo.asset}/asset.json: ${todo.id}`,
    );
  for (const todo of result.missing)
    console.log(
      `Missing from deploy/DEPLOYMENT_CHECKLIST.md: \`${todo.asset}\` · ${todo.id} — ${todo.item}`,
    );
  process.exitCode =
    result.missing.length || result.checked_but_open.length ? 1 : 0;
}
