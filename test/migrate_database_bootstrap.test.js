import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "fracto-migration-bootstrap-"),
  );
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("fracto-migration-bootstrap-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
  fs.copyFileSync(
    new URL("../scripts/migrate_database.js", import.meta.url),
    path.join(root, "migrate_database.js"),
  );
  const run = (...args) =>
    spawnSync(process.execPath, ["migrate_database.js", ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
    });
  return { root, run };
}

test("migration CLI without installed SDK gives host and Docker recovery without loading migrations", (t) => {
  const { root, run } = fixture(t);
  fs.writeFileSync(
    path.join(root, "initialize_database.js"),
    'console.log("MIGRATIONS_STARTED");',
  );
  const result = run();
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /npm ci/);
  assert.match(result.stderr, /docker compose run --build --rm database-init/);
  assert.doesNotMatch(result.stdout, /MIGRATIONS_STARTED/);
});

test("installed SDK permits migration dispatch and preserves force arguments", (t) => {
  const { root, run } = fixture(t);
  const sdk = path.join(root, "node_modules", "@fracto", "sdk");
  fs.mkdirSync(path.join(sdk, "utils"), { recursive: true });
  fs.writeFileSync(
    path.join(sdk, "package.json"),
    '{"name":"@fracto/sdk","type":"module"}',
  );
  fs.writeFileSync(
    path.join(sdk, "utils", "MigrationChecksums.js"),
    "export {};\n",
  );
  fs.writeFileSync(
    path.join(root, "initialize_database.js"),
    "console.log(JSON.stringify(process.argv.slice(2)));",
  );
  const result = run("--force", "019");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ["--force", "019"]);
});

test("service launcher preserves the original failure and reports the child exit", (t) => {
  const { root } = fixture(t);
  const scripts = path.join(root, "scripts");
  const service = path.join(root, "servers", "fixture-data-server");
  fs.mkdirSync(scripts);
  fs.mkdirSync(path.join(service, "node_modules"), { recursive: true });
  fs.copyFileSync(
    new URL("../scripts/launch_service.js", import.meta.url),
    path.join(scripts, "launch_service.js"),
  );
  fs.writeFileSync(path.join(scripts, "configure_environment.js"), "");
  fs.writeFileSync(
    path.join(root, "constants.js"),
    `
    export const ALL_SERVICES = [{name: 'fixture-data-server'}];
    export const SERVICE_NAME_UI = 'fixture-ui';
    export const SERVICE_NAME_AI = 'fixture-ai';
  `,
  );
  fs.writeFileSync(path.join(service, "package.json"), '{"type":"module"}');
  fs.writeFileSync(
    path.join(service, "index.js"),
    "console.error('Fixture startup failure'); process.exit(17);",
  );
  const result = spawnSync(
    process.execPath,
    [path.join(scripts, "launch_service.js"), "fixture-data-server"],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
      env: { ...process.env, FRACTO_WATCH: "false" },
    },
  );
  assert.equal(result.status, 17, result.stderr);
  assert.match(result.stderr, /Fixture startup failure/);
  assert.match(
    result.stderr,
    /fixture-data-server: child exited \(code=17, signal=none\)/,
  );
});
