import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  configuration_mounts,
  reconcile_managed_mounts,
} from "../scripts/managed_mounts.js";
import {
  adapt_managed_controller,
  install_managed_mount_adapter,
} from "../scripts/managed_controller_adapter.js";

const required = {
  Type: "bind",
  Source: "/host/fracto/servers/data/config",
  Target: "/app/servers/data/config",
  ReadOnly: true,
};

test("Windows configuration mounts follow the verified Docker Desktop root without reading credentials", () => {
  const configuration = {
    services: {
      fracto: {
        volumes: [
          {
            type: "bind",
            source: "E:\\mediaplex\\fracto\\config",
            target: "/app/config",
            read_only: true,
          },
          {
            type: "bind",
            source: "E:\\mediaplex\\fracto\\servers\\data\\config",
            target: required.Target,
            read_only: true,
          },
          { type: "volume", source: "keep-ai", target: "/var/lib/fracto/ai" },
        ],
      },
    },
  };
  const current = {
    Mounts: [
      {
        Type: "bind",
        Source: "/run/desktop/mnt/host/e/mediaplex/fracto/config",
        Destination: "/app/config",
      },
    ],
  };
  const result = configuration_mounts(
    configuration,
    "E:\\mediaplex\\fracto",
    current,
    () => ({ isDirectory: () => true }),
  );
  assert.equal(result.length, 2);
  assert.equal(
    result[1].Source,
    "/run/desktop/mnt/host/e/mediaplex/fracto/servers/data/config",
  );
  assert.equal(result[1].ReadOnly, true);
  assert.throws(
    () =>
      configuration_mounts(
        configuration,
        "E:\\mediaplex\\fracto",
        { Mounts: [] },
        () => ({ isDirectory: () => true }),
      ),
    /Cannot verify/,
  );
  assert.throws(
    () =>
      configuration_mounts(
        configuration,
        "E:\\mediaplex\\fracto",
        current,
        () => {
          throw Error("ENOENT");
        },
      ),
    /missing or unreadable/,
  );
});

test("new configuration binds preserve every existing data volume and runtime field", () => {
  const payload = {
    Env: ["UNCHANGED=value"],
    HostConfig: {
      Memory: 1234,
      Mounts: [
        { Type: "volume", Source: "retained-ai", Target: "/var/lib/fracto/ai" },
      ],
      Binds: ["logs:/app/logs:rw"],
    },
  };
  const original = structuredClone(payload),
    result = reconcile_managed_mounts(payload, [required]);
  assert.deepEqual(payload, original);
  assert.deepEqual(result.HostConfig.Mounts[0], original.HostConfig.Mounts[0]);
  assert.deepEqual(result.HostConfig.Mounts[1], required);
  assert.deepEqual(result.Env, original.Env);
  assert.equal(result.HostConfig.Memory, 1234);
  assert.deepEqual(result.HostConfig.Binds, original.HostConfig.Binds);
  assert.deepEqual(reconcile_managed_mounts(result, [required]), result);
});

test("configuration overrides require the same source and reject duplicate targets", () => {
  const payload = {
    HostConfig: { Binds: [`${required.Source}:${required.Target}:rw,z`] },
  };
  assert.equal(
    reconcile_managed_mounts(payload, [required]).HostConfig.Binds[0],
    `${required.Source}:${required.Target}:z,ro`,
  );
  assert.throws(
    () =>
      reconcile_managed_mounts(
        {
          HostConfig: {
            Mounts: [{ ...required, Source: "/another/private/config" }],
          },
        },
        [required],
      ),
    /Conflicting/,
  );
  assert.throws(
    () =>
      reconcile_managed_mounts(
        { HostConfig: { Mounts: [required, required] } },
        [required],
      ),
    /Duplicate/,
  );
});

const controller = `const current = {};
function upgradePayload({rehearsal}) { return {rehearsal, HostConfig: {Binds: ['ai-data:/var/lib/fracto/ai:rw']}}; }
const payload=(rehearsal,name)=>upgradePayload({old:current,rehearsal,name});
console.log(JSON.stringify([payload(false,'production'),payload(true,'rehearsal')]));`;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fracto-managed-mounts-"));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("fracto-managed-mounts-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, ".fracto-managed"));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
  fs.copyFileSync(
    new URL("../scripts/managed_mounts.js", import.meta.url),
    path.join(root, "scripts/managed_mounts.js"),
  );
  const file = path.join(root, ".fracto-managed/manage-production.mjs");
  fs.writeFileSync(file, controller);
  fs.writeFileSync(
    path.join(root, ".fracto-managed/required-config-mounts.json"),
    JSON.stringify({ schema_version: 1, mounts: [required] }),
  );
  return { root, file };
}

test("installed adapter adds production mounts, preserves AI-only rehearsal, and is repeatable with a retained backup", (t) => {
  const { root, file } = fixture(t);
  assert.equal(install_managed_mount_adapter(root), true);
  assert.equal(install_managed_mount_adapter(root), false);
  const result = spawnSync(process.execPath, [file], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  const [production, rehearsal] = JSON.parse(result.stdout);
  assert.deepEqual(production.HostConfig.Mounts, [required]);
  assert.equal(rehearsal.HostConfig.Mounts, undefined);
  const backups = fs
    .readdirSync(path.dirname(file))
    .filter((name) => name.includes("before-mount-adapter"));
  assert.equal(backups.length, 1);
  assert.equal(
    fs.readFileSync(path.join(path.dirname(file), backups[0]), "utf8"),
    controller,
  );
});

test("unsupported or ambiguous installed controllers stay unchanged", (t) => {
  const { root, file } = fixture(t);
  for (const source of [
    "const payload = somethingElse;",
    controller.replace("old:current", "old:unknown"),
    controller.replace("rehearsal,name", "x,name"),
  ]) {
    fs.writeFileSync(file, source);
    assert.throws(() => install_managed_mount_adapter(root), /Unsupported/);
    assert.equal(fs.readFileSync(file, "utf8"), source);
  }
  const adapted = adapt_managed_controller(controller);
  assert.equal(adapt_managed_controller(adapted), adapted);
});

test("the controller migration works without host npm dependencies and ignores quoted/comment decoys", (t) => {
  const { root } = fixture(t);
  fs.copyFileSync(
    new URL("../scripts/managed_controller_adapter.js", import.meta.url),
    path.join(root, "scripts/managed_controller_adapter.js"),
  );
  const source =
    `/* const payload = () => ignored; */\nconst note = 'const payload = () => ignored';\n` +
    controller;
  fs.writeFileSync(path.join(root, "source.mjs"), source);
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import fs from 'node:fs';import {adapt_managed_controller} from './scripts/managed_controller_adapter.js';const output=adapt_managed_controller(fs.readFileSync('source.mjs','utf8'));if(!output.includes('__fracto_apply_configuration_mounts(upgradePayload'))throw Error('Missing adapter');",
    ],
    { cwd: root, encoding: "utf8", timeout: 10000, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.throws(
    () =>
      adapt_managed_controller(
        "function other(){const payload=()=>0;}\n" + controller,
      ),
    /expected one/,
  );
});

test("Node syntax validation rejects an invalid staged controller without replacing its source", (t) => {
  const { root, file } = fixture(t),
    invalid = controller + "\nfunction broken(";
  fs.writeFileSync(file, invalid);
  assert.throws(
    () => install_managed_mount_adapter(root),
    /Node syntax validation/,
  );
  assert.equal(fs.readFileSync(file, "utf8"), invalid);
  assert.equal(
    fs.readdirSync(path.dirname(file)).filter((name) => name.endsWith(".mjs"))
      .length,
    1,
  );
});
