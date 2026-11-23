import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cold_boot_preflight } from "../scripts/cold_boot_preflight.js";

function fixture(t, managed = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fracto-boot-preflight-"));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("fracto-boot-preflight-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, "config"));
  fs.mkdirSync(path.join(root, "service-config"));
  const volumes = [
    {
      type: "bind",
      source: path.join(root, "config"),
      target: "/app/config",
      read_only: true,
    },
    {
      type: "bind",
      source: path.join(root, "service-config"),
      target: "/app/service/config",
      read_only: true,
    },
  ];
  let checks = 0,
    calls = 0;
  const registry = {
    schema_version: 1,
    current: {
      container_id: "a".repeat(64),
      image_id: "sha256:" + "b".repeat(64),
      name: "fracto-production",
    },
  };
  if (managed) {
    fs.mkdirSync(path.join(root, ".fracto-managed"));
    fs.writeFileSync(
      path.join(root, ".fracto-production.json"),
      JSON.stringify(registry),
    );
    fs.writeFileSync(
      path.join(root, ".fracto-managed/manage-production.mjs"),
      "const payload=(rehearsal,name)=>upgradePayload({old:current,rehearsal,name});",
    );
  }
  const actual = {
    Id: registry.current.container_id,
    Image: registry.current.image_id,
    Name: "/" + registry.current.name,
    Mounts: [
      {
        Type: "bind",
        Source: path.join(root, "config"),
        Destination: "/app/config",
      },
    ],
  };
  const options = {
    root,
    mode: "prod",
    log() {},
    check_services: async () => {
      checks++;
    },
    run: () => {
      calls++;
      return {
        status: 0,
        stdout: JSON.stringify({ services: { fracto: { volumes } } }),
      };
    },
    docker: { inspect: () => actual, named: () => null },
  };
  return { root, options, volumes, checks: () => checks, calls: () => calls };
}

test("service-owned configuration failures stop before Docker or any recovery", async (t) => {
  const f = fixture(t, true);
  await assert.rejects(
    cold_boot_preflight({
      ...f.options,
      check_services: async () => {
        throw Error("SERVICE_CONFIGURATION_MISSING");
      },
    }),
    /SERVICE_CONFIGURATION_MISSING/,
  );
  assert.equal(f.calls(), 0);
  assert.equal(
    fs.existsSync(
      path.join(f.root, ".fracto-managed/required-config-mounts.json"),
    ),
    false,
  );
});

test("a missing read-only configuration directory stops before creating a managed adapter", async (t) => {
  const f = fixture(t, true);
  fs.rmdirSync(path.join(f.root, "service-config"));
  await assert.rejects(
    cold_boot_preflight(f.options),
    /mount source is missing/,
  );
  assert.equal(
    fs
      .readFileSync(
        path.join(f.root, ".fracto-managed/manage-production.mjs"),
        "utf8",
      )
      .includes("__fracto_"),
    false,
  );
});

test("managed preflight prepares a read-only configuration contract without changing registration", async (t) => {
  const f = fixture(t, true),
    file = path.join(f.root, ".fracto-production.json"),
    original = fs.readFileSync(file, "utf8");
  await cold_boot_preflight(f.options);
  const contract = JSON.parse(
    fs.readFileSync(
      path.join(f.root, ".fracto-managed/required-config-mounts.json"),
      "utf8",
    ),
  );
  assert.equal(contract.mounts.length, 2);
  assert.ok(contract.mounts.every((mount) => mount.ReadOnly));
  assert.equal(contract.mounts[1].Target, "/app/service/config");
  assert.equal(fs.readFileSync(file, "utf8"), original);
  await cold_boot_preflight(f.options);
  assert.equal(f.checks(), 2);
});

test("ordinary Compose and development preflight do not install a managed controller", async (t) => {
  const f = fixture(t);
  await cold_boot_preflight(f.options);
  assert.equal(fs.existsSync(path.join(f.root, ".fracto-managed")), false);
  const managed = fixture(t, true);
  await cold_boot_preflight({ ...managed.options, mode: "dev" });
  assert.equal(
    fs.existsSync(
      path.join(managed.root, ".fracto-managed/required-config-mounts.json"),
    ),
    false,
  );
});
