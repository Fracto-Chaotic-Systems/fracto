import fs from "node:fs";
import path from "node:path";

/** Deployment inventory must be usable before npm dependencies are installed. */
export function repository_inventory(
  root = path.resolve(import.meta.dirname, ".."),
) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const names = manifest.fracto?.serviceRepositories;
  if (
    !Array.isArray(names) ||
    !names.length ||
    new Set(names).size !== names.length ||
    names.some(
      (name) =>
        typeof name !== "string" ||
        !/^fracto-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name),
    )
  ) {
    throw new Error(
      "package.json must declare unique fracto.serviceRepositories names",
    );
  }
  return [
    { name: "fracto", directory: root },
    ...names.map((name) => ({
      name,
      directory: path.join(root, "servers", name),
    })),
  ];
}
