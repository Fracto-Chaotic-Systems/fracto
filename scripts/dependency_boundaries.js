import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";

const relative = (root, file) =>
  path.relative(root, file).replaceAll("\\", "/");
const owner = (root, file) => {
  const name = relative(root, file);
  if (name === ".." || name.startsWith("../")) return "external";
  if (name.startsWith("sdk/")) return "sdk";
  return name.match(/^servers\/([^/]+)\//)?.[1] || "root";
};

export function dependency_violation(
  root,
  file,
  specifier,
  package_owners = {},
) {
  const consumer = owner(root, file);
  if (specifier === "@fracto/sdk" || specifier.startsWith("@fracto/sdk/"))
    return specifier.split("/").includes("..")
      ? "SDK package path escapes its interface"
      : null;
  const other_package = Object.keys(package_owners).find(
    (name) => specifier === name || specifier.startsWith(`${name}/`),
  );
  if (other_package && package_owners[other_package] !== consumer)
    return "Server packages are accessed through endpoints, not imports";
  if (
    !specifier.startsWith(".") &&
    !path.isAbsolute(specifier) &&
    !specifier.startsWith("file:")
  )
    return null;
  let target = specifier.startsWith("file:")
    ? fileURLToPath(specifier)
    : path.resolve(path.dirname(file), specifier);
  if (fs.existsSync(target)) target = fs.realpathSync(target);
  const provider = owner(root, target);
  if (consumer === provider) return null;
  if (provider === "external")
    return "Filesystem dependency leaves the known repository owners";
  if (provider === "sdk")
    return "Consume the SDK through @fracto/sdk, not a filesystem path";
  if (consumer === "root")
    return "Root code cannot import a server implementation";
  if (consumer === "sdk")
    return "The SDK cannot import a consumer implementation";
  return provider === "root"
    ? "Server code cannot import root files"
    : "Servers communicate through endpoints, not implementation imports";
}

export function inspect_dependency_imports(
  source,
  file,
  root,
  package_owners = {},
) {
  const tree = parse(source, {
    sourceType: "unambiguous",
    plugins: ["jsx", "importAttributes"],
    allowReturnOutsideFunction: true,
  });
  const findings = [],
    pending = [tree];
  const check = (node) => {
    const value =
      node?.type === "StringLiteral"
        ? node.value
        : node?.type === "TemplateLiteral" && node.expressions.length === 0
          ? node.quasis[0].value.cooked
          : null;
    if (typeof value !== "string") return;
    const reason = dependency_violation(root, file, value, package_owners);
    if (reason)
      findings.push({
        file: relative(root, file),
        line: node.loc.start.line,
        start: node.start,
        end: node.end,
        specifier: value,
        reason,
      });
  };
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== "object") continue;
    if (
      [
        "ImportDeclaration",
        "ExportNamedDeclaration",
        "ExportAllDeclaration",
      ].includes(node.type)
    )
      check(node.source);
    if (node.type === "ImportExpression") check(node.source);
    // A filesystem URL into the SDK bypasses its npm exports even when used
    // to load a resource or construct a child-process import.
    if (
      node.type === "NewExpression" &&
      node.callee?.name === "URL" &&
      node.arguments[0]?.type === "StringLiteral" &&
      dependency_violation(
        root,
        file,
        node.arguments[0].value,
        package_owners,
      )?.includes("SDK")
    )
      check(node.arguments[0]);
    if (
      node.type === "CallExpression" &&
      (node.callee?.type === "Import" ||
        (node.callee?.type === "Identifier" && node.callee.name === "require"))
    )
      check(node.arguments[0]);
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "comments", "tokens", "extra"].includes(key))
        continue;
      if (Array.isArray(value)) pending.push(...value);
      else if (value && typeof value === "object") pending.push(value);
    }
  }
  return findings;
}

const ignored = new Set([
  "node_modules",
  ".git",
  ".idea",
  ".vs",
  ".codex",
  ".agents",
  ".fracto-managed",
  "dist",
  "coverage",
  "archive",
  ".archive",
  "generated",
  "logs",
  "tmp",
  "backup",
  "config",
  "images",
  "videos",
]);
export function audit_dependency_boundaries(root) {
  const packages = {},
    findings = [];
  const services = path.join(root, "servers");
  if (fs.existsSync(services))
    for (const name of fs.readdirSync(services)) {
      const manifest = path.join(services, name, "package.json");
      if (fs.existsSync(manifest))
        packages[JSON.parse(fs.readFileSync(manifest, "utf8")).name] = name;
    }
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
      const file = path.join(directory, entry.name);
      // This is the root numerical runtime store, not UI/SDK tiles source folders.
      if (file === path.join(root, "tiles")) continue;
      // Imported model resources are data; application folders named models still get audited.
      if (file === path.join(root, "servers", "fracto-asset-server", "models"))
        continue;
      if (entry.isDirectory()) walk(file);
      else if (/\.(?:js|jsx|mjs|cjs)$/.test(entry.name)) {
        try {
          findings.push(
            ...inspect_dependency_imports(
              fs.readFileSync(file, "utf8"),
              file,
              root,
              packages,
            ),
          );
        } catch (error) {
          findings.push({
            file: relative(root, file),
            line: error.loc?.line || 1,
            specifier: "",
            reason: "Source could not be parsed",
          });
        }
      }
    }
  };
  walk(root);
  return findings.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
  );
}
