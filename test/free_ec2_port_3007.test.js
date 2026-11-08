import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const script = fileURLToPath(
  new URL("../scripts/free_ec2_port_3007.sh", import.meta.url),
);
const options = {
  skip: process.platform !== "linux" || process.getuid?.() !== 0,
};
const public_config = "server {\n  listen 3000;\n}\n";
const original = public_config + "server {\n  listen 127.0.0.1:3007;\n}\n";

function fixture(run) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "fracto-nginx-port-"),
  );
  try {
    const bin = path.join(directory, "bin"),
      config = path.join(directory, "legacy.conf"),
      log = path.join(directory, "actions");
    fs.mkdirSync(bin);
    fs.writeFileSync(config, original);
    const command = (name, body) =>
      fs.writeFileSync(
        path.join(bin, name),
        "#!/usr/bin/env bash\nset -eu\n" + body,
        { mode: 0o755 },
      );
    command(
      "ss",
      'if grep -q "listen 127.0.0.1:3007;" "$FAKE_CONFIG"; then printf \'LISTEN 0 511 127.0.0.1:3007 0.0.0.0:* users:(("%s",pid=999999,fd=6))\\n\' "${FAKE_OWNER:-nginx}"; fi\n',
    );
    command(
      "nginx",
      'case "$1" in -T) printf "# configuration file %s:\\n" "$FAKE_CONFIG"; cat "$FAKE_CONFIG" ;; -t) if grep -q INVALID "$FAKE_CONFIG"; then exit 1; fi ;; *) exit 2 ;; esac\n',
    );
    command(
      "systemctl",
      'printf "%s\\n" "$*" >> "$FAKE_LOG"\nif [[ "${FAKE_RELOAD_FAILURE:-0}" == 1 && "$(wc -l < "$FAKE_LOG")" == 1 ]]; then exit 1; fi\n',
    );
    command(
      "editor",
      'if [[ "${FAKE_EDIT_MODE:-valid}" == invalid ]]; then echo INVALID > "$1"; else printf "server {\\n  listen 3000;\\n}\\n" > "$1"; fi\n',
    );
    const env = {
      ...process.env,
      PATH: bin + path.delimiter + process.env.PATH,
      EDITOR: path.join(bin, "editor"),
      FAKE_CONFIG: config,
      FAKE_LOG: log,
      FRACTO_NGINX_BACKUP_DIR: path.join(directory, "backups"),
    };
    run({
      directory,
      config,
      log,
      env,
      execute: (mode, extra = {}) =>
        spawnSync("bash", [script, mode], {
          env: { ...env, ...extra },
          input: "1\n",
          encoding: "utf8",
          timeout: 20000,
        }),
    });
  } finally {
    assert.ok(
      path
        .resolve(directory)
        .startsWith(path.join(os.tmpdir(), "fracto-nginx-port-")),
    );
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test(
  "port inspection identifies nginx configuration without changing it or reloading",
  options,
  () =>
    fixture(({ config, log, execute }) => {
      const result = execute("--inspect");
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.ok(result.stdout.includes(config));
      assert.equal(fs.readFileSync(config, "utf8"), original);
      assert.equal(fs.existsSync(log), false);
    }),
);

test(
  "reviewed nginx edit retains public listener, backs up original, reloads and verifies port release",
  options,
  () =>
    fixture(({ directory, config, log, execute }) => {
      const result = execute("--edit");
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(fs.readFileSync(config, "utf8"), public_config);
      assert.equal(fs.readFileSync(log, "utf8"), "reload nginx.service\n");
      const [backup] = fs.readdirSync(path.join(directory, "backups"));
      assert.equal(
        fs.readFileSync(
          path.join(directory, "backups", backup, "original.conf"),
          "utf8",
        ),
        original,
      );
      assert.match(result.stdout, /3007 is free; nginx is still running/);
    }),
);

test("invalid nginx edits restore original and never reload", options, () =>
  fixture(({ config, log, execute }) => {
    const result = execute("--edit", { FAKE_EDIT_MODE: "invalid" });
    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(config, "utf8"), original);
    assert.equal(fs.existsSync(log), false);
  }),
);

test("non-nginx listeners are left alone", options, () =>
  fixture(({ config, log, execute }) => {
    const result = execute("--edit", { FAKE_OWNER: "node" });
    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(config, "utf8"), original);
    assert.equal(fs.existsSync(log), false);
  }),
);

test(
  "reload failure restores the original configuration and reloads the restored file",
  options,
  () =>
    fixture(({ config, log, execute }) => {
      const result = execute("--edit", { FAKE_RELOAD_FAILURE: "1" });
      assert.notEqual(result.status, 0);
      assert.equal(fs.readFileSync(config, "utf8"), original);
      assert.equal(
        fs.readFileSync(log, "utf8"),
        "reload nginx.service\nreload nginx.service\n",
      );
      assert.match(result.stderr, /Restored the original nginx file/);
    }),
);
