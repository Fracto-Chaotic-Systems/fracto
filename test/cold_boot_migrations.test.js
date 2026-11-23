import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../scripts/cold_boot.bat", import.meta.url),
  "utf8",
);

function simulate(
  t,
  { mode = "prod", managed = false, fail = "", refresh = false } = {},
) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "fracto-boot-migrations-"),
  );
  t.after(() => {
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
    );
    assert.ok(path.basename(directory).startsWith("fracto-boot-migrations-"));
    fs.rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });
  const root = path.join(directory, "checkout with spaces");
  const scripts = path.join(root, "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  const trace = path.join(directory, "trace.txt");
  const docker = path.join(directory, "docker.cmd");
  const npm = path.join(directory, "npm.cmd");
  const phase = path.join(directory, "phase.cjs");
  fs.writeFileSync(
    phase,
    `
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FRACTO_BOOT_TRACE, args.join(' ') + '\\n');
const stage = args[0] === 'docker' && args.includes('database-init') ? 'migration'
  : args[0] === 'docker' && args.includes('stop') ? 'stop'
  : args[0] === 'managed' && args[1] === 'stop' ? 'stop'
  : args[0];
process.exit(stage === process.env.FRACTO_BOOT_FAIL ? 41 : 0);
`,
  );
  const command = (name) =>
    `@echo off\r\n"${process.execPath}" "${phase}" ${name} %*\r\nexit /b %ERRORLEVEL%\r\n`;
  fs.writeFileSync(docker, command("docker"));
  fs.writeFileSync(npm, command("updater"));
  // CALL keeps the fake .cmd tool's return semantics equivalent to docker.exe.
  // Every Docker call is replaced: this fixture cannot reach real containers.
  fs.writeFileSync(
    path.join(scripts, "cold_boot.bat"),
    source
      .replaceAll("docker compose", `call "${docker}" compose`)
      .replace("call npm run update:repos", `call "${npm}" run update:repos`),
  );
  fs.writeFileSync(
    path.join(scripts, "ensure_exclusive.bat"),
    command("exclusive"),
  );
  for (const [name, label] of [
    ["write_build_info", "build-info"],
    ["build_windows_image", "build"],
    ["windows_host_startup", "observer"],
    ["managed_production", "managed"],
  ]) {
    fs.writeFileSync(
      path.join(scripts, name + ".js"),
      `process.argv.splice(2,0,${JSON.stringify(label)});require(${JSON.stringify(phase)});`,
    );
  }
  fs.writeFileSync(
    path.join(scripts, "clear_stale_wsl_relays.ps1"),
    'param([string]$Mode)\nAdd-Content -LiteralPath $env:FRACTO_BOOT_TRACE -Value "relay $Mode"\nexit 0\n',
  );
  if (managed)
    fs.writeFileSync(path.join(root, ".fracto-production.json"), "{}");
  const result = spawnSync(
    process.env.ComSpec || "cmd.exe",
    [
      "/d",
      "/s",
      "/c",
      `""${path.join(scripts, "cold_boot.bat")}" ${mode} --root-updated"`,
    ],
    {
      cwd: directory,
      input: refresh ? "Y\r\n" : "N\r\n",
      encoding: "utf8",
      windowsHide: true,
      windowsVerbatimArguments: true,
      timeout: 30000,
      env: { ...process.env, FRACTO_BOOT_TRACE: trace, FRACTO_BOOT_FAIL: fail },
    },
  );
  assert.equal(result.error, undefined);
  return {
    ...result,
    steps: fs.existsSync(trace)
      ? fs.readFileSync(trace, "utf8").trim().split(/\r?\n/)
      : [],
  };
}

test("cold boot uses the rebuilt Docker maintenance image for migration detection", () => {
  assert.match(
    source,
    /docker compose run --rm --no-deps --no-build database-init\r?\nif errorlevel 1 goto failed/,
  );
  assert.ok(
    source.indexOf("build_windows_image.js") <
      source.indexOf(":migrate_database"),
  );
  assert.doesNotMatch(
    source,
    /npm run db:migrate|node scripts\\migrate_database/,
  );
});

for (const options of [
  { mode: "prod" },
  { mode: "dev" },
  { mode: "prod", managed: true },
]) {
  const label = options.managed ? "managed production" : options.mode;
  test(
    `${label} stops before migrations and starts only after successful detection/application`,
    { skip: process.platform !== "win32" },
    (t) => {
      const result = simulate(t, options);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const steps = result.steps;
      const stop = steps.findIndex((step) => /\bstop\b/.test(step));
      const migration = steps.indexOf(
        "docker compose run --rm --no-deps --no-build database-init",
      );
      const start = steps.findIndex((step) =>
        /\bup\b|managed upgrade/.test(step),
      );
      assert.ok(steps.indexOf(`build ${options.mode}`) < stop);
      assert.ok(
        stop >= 0 && migration > stop && start > migration,
        steps.join("\n"),
      );
      assert.equal(
        steps.filter((step) => step.includes("database-init")).length,
        1,
      );
      assert.ok(steps.findIndex((step) => step.startsWith("relay ")) > start);
      if (options.managed) assert.equal(steps[stop], "managed stop");
      else
        assert.equal(
          steps[stop],
          options.mode === "dev"
            ? "docker compose -f compose.yaml -f compose.dev.yaml stop fracto-dev"
            : "docker compose stop fracto",
        );
    },
  );
  test(
    `${label} migration failure preserves the exit code and prevents application start`,
    { skip: process.platform !== "win32" },
    (t) => {
      const result = simulate(t, { ...options, fail: "migration" });
      assert.equal(result.status, 41, result.stdout + result.stderr);
      assert.ok(result.steps.some((step) => step.includes("database-init")));
      assert.ok(
        !result.steps.some((step) =>
          /\bup\b|managed upgrade|relay /.test(step),
        ),
      );
    },
  );
}

for (const fail of ["build", "stop"]) {
  test(
    `${fail} failure prevents migration execution and application start`,
    { skip: process.platform !== "win32" },
    (t) => {
      const result = simulate(t, { fail });
      assert.equal(result.status, 41, result.stdout + result.stderr);
      assert.ok(
        !result.steps.some((step) => /database-init|\bup\b/.test(step)),
      );
    },
  );
}

test(
  "optional index refresh completes before stopping and migrating",
  { skip: process.platform !== "win32" },
  (t) => {
    const result = simulate(t, { refresh: true });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(
      result.steps.indexOf("docker compose run --rm index-refresh") <
        result.steps.indexOf("docker compose stop fracto"),
    );
  },
);
