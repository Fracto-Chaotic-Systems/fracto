import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const NAME = "__fracto_apply_configuration_mounts";
const SOURCE = "../scripts/managed_mounts.js";
const digest = (source) => createHash("sha256").update(source).digest("hex");

// Accept only the known identifier/member-only factory. Mask quoted/comment text
// to reject decoys; Node checks the complete result. No host npm install is needed.
const code_mask = (source) =>
  source.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g,
    (part) => part.replace(/[^\r\n]/g, " "),
  );

export function adapt_managed_controller(source) {
  const mask = code_mask(source);
  const factories = [...mask.matchAll(/\b(?:const|let|var)\s+payload\s*=/g)];
  if (factories.length !== 1)
    throw Error(
      "Unsupported installed managed controller: expected one payload factory",
    );
  const at = factories[0].index;
  const head =
    /^(?:const|let|var)\s+payload\s*=\s*\(\s*rehearsal\s*,\s*name\s*\)\s*=>\s*/.exec(
      mask.slice(at),
    );
  if (!head)
    throw Error("Unsupported installed managed controller payload factory");
  const start = at + head[0].length;
  const identifier = "[A-Za-z_$][\\w$]*";
  const member = `${identifier}(?:\\s*\\.\\s*${identifier})*`;
  const property = `${identifier}(?:\\s*:\\s*${member})?`;
  const call = `upgradePayload\\s*\\(\\s*\\{\\s*(${property}(?:\\s*,\\s*${property})*\\s*,?)\\s*\\}\\s*\\)`;
  const adapted = mask.slice(start).startsWith(NAME);
  const expression = new RegExp(
    adapted
      ? `^${NAME}\\s*\\(\\s*(${call})\\s*,\\s*\\{\\s*rehearsal\\s*\\}\\s*\\)\\s*;`
      : `^(${call})\\s*;`,
  ).exec(mask.slice(start));
  if (!expression)
    throw Error("Unsupported installed managed controller payload factory");
  const properties = expression[2]
    .split(",")
    .map((item) => item.replace(/\s/g, ""));
  if (
    !properties.includes("old:current") ||
    !properties.some((item) =>
      ["rehearsal", "rehearsal:rehearsal"].includes(item),
    )
  )
    throw Error("Unsupported installed managed controller payload factory");
  const imports = [
    ...source.matchAll(
      new RegExp(
        `import\\s*\\{\\s*apply_managed_configuration_mounts\\s+as\\s+${NAME}\\s*\\}\\s*from\\s*(["'])\\.\\./scripts/managed_mounts\\.js\\1\\s*;`,
        "g",
      ),
    ),
  ].filter((item) => mask.slice(item.index, item.index + 6) === "import");
  if (adapted) {
    if (
      imports.length !== 1 ||
      [...mask.matchAll(new RegExp(`\\b${NAME}\\b`, "g"))].length !== 2
    )
      throw Error("Invalid installed managed mount adapter");
    return source;
  }
  if (mask.includes(NAME) || imports.length)
    throw Error("Managed mount adapter identifier conflict");
  const end = start + expression[1].length;
  const wrapped =
    source.slice(0, start) +
    NAME +
    "(" +
    source.slice(start, end) +
    ", {rehearsal})" +
    source.slice(end);
  const insert = source.startsWith("#!") ? source.indexOf("\n") + 1 : 0;
  return (
    wrapped.slice(0, insert) +
    `import {apply_managed_configuration_mounts as ${NAME}} from ${JSON.stringify(SOURCE)};\n` +
    wrapped.slice(insert)
  );
}

export function install_managed_mount_adapter(root, run = spawnSync) {
  const file = path.join(root, ".fracto-managed", "manage-production.mjs");
  if (!fs.lstatSync(file).isFile())
    throw Error("Managed controller must be a regular file");
  const source = fs.readFileSync(file, "utf8"),
    output = adapt_managed_controller(source);
  if (source === output) return false;
  const backup = file + ".before-mount-adapter-" + digest(source).slice(0, 16);
  try {
    fs.writeFileSync(backup, source, { flag: "wx" });
  } catch (error) {
    if (
      error.code !== "EEXIST" ||
      digest(fs.readFileSync(backup)) !== digest(source)
    )
      throw error;
  }
  const temporary = file + "." + randomUUID() + ".mjs";
  try {
    fs.writeFileSync(temporary, output, { flag: "wx" });
    const checked = run(process.execPath, ["--check", temporary], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      windowsHide: true,
      shell: false,
    });
    if (checked.error || checked.status !== 0)
      throw Error(
        "Managed controller adapter failed Node syntax validation; original controller retained",
      );
    if (digest(fs.readFileSync(file)) !== digest(source))
      throw Error("Managed controller changed during adapter installation");
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return true;
}
