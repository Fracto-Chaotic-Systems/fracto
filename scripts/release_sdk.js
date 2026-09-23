import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repository_root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const package_path = path.join(repository_root, "sdk", "package.json");
const sdk_package = JSON.parse(fs.readFileSync(package_path, "utf8"));
const version_pattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const [command, requested_version] = process.argv.slice(2);

const run = (executable, args) => {
  const result = spawnSync(executable, args, {
    cwd: repository_root,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

if (command === "check") {
  run(process.execPath, ["scripts/check_sdk_consumers.js"]);
  run(process.execPath, [
    "--test",
    "test/sdk_canvas_buffer.test.js",
    "test/sdk_package.test.js",
  ]);
  console.log(`SDK release checks passed for ${sdk_package.version}`);
  process.exit(0);
}

if (command !== "version" || !version_pattern.test(requested_version || "")) {
  console.error("Usage: npm run sdk:release -- check");
  console.error("   or: npm run sdk:release -- version <major.minor.patch>");
  process.exit(1);
}

if (requested_version === sdk_package.version) {
  console.error(`SDK is already at version ${requested_version}`);
  process.exit(1);
}

run(process.execPath, ["scripts/check_sdk_consumers.js"]);
run(process.execPath, [
  "--test",
  "test/sdk_canvas_buffer.test.js",
  "test/sdk_package.test.js",
]);

const next_package = {
  ...sdk_package,
  version: requested_version,
};
fs.writeFileSync(package_path, `${JSON.stringify(next_package, null, 2)}\n`);
console.log(
  `Updated @fracto/sdk from ${sdk_package.version} to ${requested_version}`,
);
console.log(
  "Commit the root SDK change and the four consumer lockfiles before tagging.",
);
