import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function fixture(t, check, { data_config, database_stub } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fracto-service-check-"));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("fracto-service-check-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const write = (file, source) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
  };
  write("package.json", '{"type":"module"}');
  write("scripts/configure_environment.js", "");
  for (const file of ["startup_preflight.js", "run_owned_task.js"]) {
    fs.copyFileSync(
      new URL(`../scripts/${file}`, import.meta.url),
      path.join(root, "scripts", file),
    );
  }
  write(
    "constants.js",
    `
    export const ALL_SERVICES = [{name: 'fixture-service', port: 3002}${data_config ? ", {name: 'fracto-data-server', port: 3003}" : ""}];
    export const SERVICE_NAME_UI = 'fixture-ui';
  `,
  );
  write(
    "config/mysql.json",
    '{"host":"fixture.invalid","database":"fixture","user":"fixture"}',
  );
  // Any attempt to contact MySQL fails with an explicit marker instead.
  write(
    "node_modules/mysql2/package.json",
    JSON.stringify({
      type: "module",
      exports: { "./promise": "./promise.js" },
    }),
  );
  write(
    "node_modules/mysql2/promise.js",
    database_stub || "export default { createConnection() { throw new Error('DATABASE_CHECK_REACHED'); } };",
  );
  write(
    "servers/fixture-service/package.json",
    JSON.stringify({
      type: "module",
      fracto: {
        commands: check === null ? {} : { startup_check: "scripts/check.js" },
      },
    }),
  );
  write(
    "servers/fixture-service/index.js",
    "throw new Error('SERVICE_MUST_NOT_START');",
  );
  fs.mkdirSync(path.join(root, "servers/fixture-service/node_modules"));
  if (data_config) {
    write("servers/fracto-data-server/package.json", '{"type":"module"}');
    write("servers/fracto-data-server/index.js", "throw new Error('SERVICE_MUST_NOT_START');");
    write("servers/fracto-data-server/config/mysql.json", JSON.stringify(data_config));
    fs.mkdirSync(path.join(root, "servers/fracto-data-server/node_modules"));
  }
  if (check !== null) write("servers/fixture-service/scripts/check.js", check);
  return (environment = {}) =>
    spawnSync(process.execPath, ["scripts/startup_preflight.js"], {
      cwd: root,
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
      env: { ...process.env, FRACTO_TILE_SOURCE_MODE: "remote", ...environment },
    });
}

test("a failed service-owned startup check stops root preflight before database checks", (t) => {
  const run = fixture(
    t,
    "console.error('SERVICE_CONFIGURATION_MISSING'); process.exit(23);",
  );
  const result = run();
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /SERVICE_CONFIGURATION_MISSING/);
  assert.match(result.stderr, /fixture-service:startup_check \(23\)/);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /DATABASE_CHECK_REACHED|SERVICE_MUST_NOT_START/,
  );
});

test("root credentials passing does not hide rejected data-service credentials", (t) => {
  const result = fixture(t, null, {
    data_config: { host: "fixture.invalid", user: "root", password: "service-secret", database: "fracto" },
    database_stub: `export default { async createConnection(options) {
      if (options.user === 'root') throw Object.assign(new Error('denied'), { code: 'ER_ACCESS_DENIED_ERROR' });
      return { async query() {}, async end() {} };
    } };`,
  })();
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /Database preflight passed for fixture@/);
  assert.match(result.stderr, /Database rejected credentials for root/);
  assert.match(result.stderr, /check servers\/fracto-data-server\/config\/mysql.json/);
  assert.doesNotMatch(result.stdout + result.stderr, /service-secret|SERVICE_MUST_NOT_START/);
});

test("data-service preflight uses its own database and credentials with host and port overrides", (t) => {
  const result = fixture(t, null, {
    data_config: { host: "service.invalid", user: "fracto_app", password: "service-secret", database: "service_db" },
    database_stub: `export default { async createConnection(options) {
      if (options.user === 'fracto_app' && (
        options.database !== 'service_db' || options.password !== 'service-secret' ||
        options.host !== 'host.docker.internal' || options.port !== 3307
      )) throw new Error('WRONG_SERVICE_OPTIONS');
      return { async query() {}, async end() {} };
    } };`,
  })({ FRACTO_MYSQL_HOST: "host.docker.internal", FRACTO_MYSQL_PORT: "3307", FRACTO_MYSQL_DATABASE: "root_db" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /fracto-data-server database preflight passed for fracto_app@host.docker.internal:3307\/service_db/);
  assert.doesNotMatch(result.stdout + result.stderr, /service-secret/);
});

test("a successful declared check allows root preflight to continue", (t) => {
  const run = fixture(t, "console.log('SERVICE_CONFIGURATION_OK');");
  const result = run();
  assert.equal(result.status, 1); // The intentionally mocked database is unavailable.
  assert.match(result.stdout, /SERVICE_CONFIGURATION_OK/);
  assert.match(result.stderr, /DATABASE_CHECK_REACHED/);
});

test("services without a declared startup check remain supported", (t) => {
  const result = fixture(t, null)();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DATABASE_CHECK_REACHED/);
  assert.doesNotMatch(result.stderr, /No unique declared service task/);
});
