import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  recover_managed_production,
  with_managed_recovery_lock,
} from "../scripts/managed_recovery.js";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fracto-recovery-"));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("fracto-recovery-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const captures = path.join(root, ".fracto-managed/captures"),
    directory = path.join(captures, "managed-upgrade-first");
  fs.mkdirSync(directory, { recursive: true });
  const name = "fracto-fracto-1",
    old_id = "a".repeat(64),
    active_id = "b".repeat(64),
    collision_id = "c".repeat(64);
  const old_image = "sha256:" + "d".repeat(64),
    candidate_image = "sha256:" + "e".repeat(64),
    prior_image = "sha256:" + "f".repeat(64);
  const previous = { container_id: old_id, image_id: old_image, name };
  const registry = {
    schema_version: 1,
    current: previous,
    capture_directory: captures,
    latest_operation: directory,
  };
  const journal = {
    phase: "rollback_requires_attention",
    old_container_id: old_id,
    old_image_id: old_image,
    old_name: name,
    production_name: name,
    candidate_image_id: candidate_image,
    previous,
  };
  const registry_file = path.join(root, ".fracto-production.json"),
    journal_file = path.join(directory, "journal.json");
  const write = () => {
    fs.writeFileSync(registry_file, JSON.stringify(registry));
    fs.writeFileSync(journal_file, JSON.stringify(journal));
  };
  write();
  fs.writeFileSync(
    path.join(directory, "compose.production.json"),
    JSON.stringify({
      name: "release-first",
      services: { fracto: { image: candidate_image, container_name: name } },
    }),
  );
  const prior = path.join(captures, "managed-upgrade-prior");
  fs.mkdirSync(prior);
  fs.writeFileSync(
    path.join(prior, "journal.json"),
    JSON.stringify({
      phase: "rolled_back",
      candidate_container_id: collision_id,
      candidate_image_id: prior_image,
    }),
  );
  const container = (id, image, container_name) => ({
    Id: id,
    Image: image,
    Name: "/" + container_name,
    State: { Running: false, Status: "exited" },
    Config: { Labels: {} },
  });
  const old = container(old_id, old_image, name + "-rollback-first"),
    active = container(active_id, candidate_image, name),
    collision = container(collision_id, prior_image, name + "-failed");
  active.Config.Labels = {
    "com.docker.compose.project": "release-first",
    "com.docker.compose.service": "fracto",
  };
  const containers = new Map(
      [old, active, collision].map((item) => [item.Id, item]),
    ),
    renames = [];
  const docker = {
    inspect: (id) => {
      if (!containers.has(id)) throw Error("Missing container");
      return structuredClone(containers.get(id));
    },
    named: (value) =>
      structuredClone(
        [...containers.values()].find((item) => item.Name === "/" + value) ||
          null,
      ),
    rename: (id, value) => {
      if (docker.named(value)) throw Error("Docker HTTP 409");
      renames.push([id, value]);
      containers.get(id).Name = "/" + value;
    },
  };
  let rollbacks = 0;
  const rollback = () => {
    rollbacks++;
    if (active.Name === "/" + name) docker.rename(active_id, name + "-failed");
    if (old.Name !== "/" + name) docker.rename(old_id, name);
    old.State = { Running: true, Status: "running" };
    registry.latest_operation = null;
    journal.phase = "rolled_back";
    write();
    return 0;
  };
  const recover = (options) =>
    recover_managed_production({
      root,
      docker,
      rollback,
      log() {},
      ...options,
    });
  return {
    root,
    captures,
    directory,
    old,
    active,
    collision,
    containers,
    renames,
    docker,
    registry,
    journal,
    write,
    registry_file,
    journal_file,
    recover,
    rollbacks: () => rollbacks,
  };
}

test("cold boot resolves the retained failed-name conflict, then delegates rollback and verifies the original production ID", (t) => {
  const f = fixture(t),
    before_ids = [...f.containers.keys()];
  const restored = f.recover();
  assert.equal(restored.Id, f.old.Id);
  assert.equal(restored.State.Running, true);
  assert.deepEqual([...f.containers.keys()], before_ids); // No container/volume deletion.
  assert.equal(f.renames[0][0], f.collision.Id);
  assert.ok(f.collision.Name.startsWith("/fracto-fracto-1-failed-retained-"));
  assert.ok(f.active.Name.startsWith("/fracto-fracto-1-failed-retained-"));
  assert.equal(f.registry.latest_operation, null);
  assert.equal(f.rollbacks(), 1);
  const events = fs
    .readFileSync(path.join(f.directory, "cold-boot-recovery.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.deepEqual(
    events.map((event) => event.event),
    ["retain-planned", "retained"],
  );
  assert.equal(f.renames.length, 4);
  f.recover();
  assert.equal(f.rollbacks(), 1);
  assert.equal(f.renames.length, 4);
  assert.equal(f.docker.named("fracto-fracto-1-failed"), null);
  f.recover();
  assert.equal(f.rollbacks(), 1);
  assert.equal(f.renames.length, 4);
});

test("a failed rollback leaves the retained rename recoverable on the next cold boot", (t) => {
  const f = fixture(t);
  assert.throws(
    () => f.recover({ rollback: () => 41 }),
    /Managed rollback failed \(41\)/,
  );
  assert.equal(f.renames.length, 1);
  assert.equal(f.journal.phase, "rollback_requires_attention");
  f.recover();
  assert.equal(f.rollbacks(), 1);
  assert.equal(f.renames.length, 4);
});

for (const condition of [
  "running",
  "unknown",
  "image-changed",
  "unrelated-production",
  "unexpected-old-name",
  "wrong-journal",
  "development",
]) {
  test(`automatic recovery refuses ${condition} without renaming any container`, (t) => {
    const f = fixture(t);
    if (condition === "running")
      f.collision.State = { Running: true, Status: "running" };
    if (condition === "unknown")
      fs.unlinkSync(
        path.join(f.captures, "managed-upgrade-prior/journal.json"),
      );
    if (condition === "image-changed")
      f.collision.Image = "sha256:" + "1".repeat(64);
    if (condition === "unrelated-production") f.active.Config.Labels = {};
    if (condition === "unexpected-old-name") f.old.Name = "/another-container";
    if (condition === "wrong-journal") {
      f.journal.previous = {
        ...f.journal.previous,
        image_id: "sha256:" + "2".repeat(64),
      };
      f.write();
    }
    assert.throws(() =>
      f.recover(condition === "development" ? { mode: "dev" } : {}),
    );
    assert.equal(f.renames.length, 0);
    assert.equal(f.rollbacks(), 0);
  });
}

test("a concurrent journal change prevents container renaming", (t) => {
  const f = fixture(t),
    inspect = f.docker.inspect;
  f.docker.inspect = (id) => {
    if (id === f.collision.Id) fs.appendFileSync(f.journal_file, " ");
    return inspect(id);
  };
  assert.throws(() => f.recover(), /state changed/);
  assert.equal(f.renames.length, 0);
  assert.equal(f.rollbacks(), 0);
});

test("an unrelated retained-name occupant blocks recovery instead of being overwritten", (t) => {
  const f = fixture(t);
  const another = {
    ...structuredClone(f.collision),
    Id: "9".repeat(64),
    Name: "/fracto-fracto-1-failed-retained-" + f.collision.Id.slice(0, 16),
  };
  f.containers.set(another.Id, another);
  assert.throws(() => f.recover(), /destination is already occupied/);
  assert.equal(f.renames.length, 0);
});

test("managed recovery serializes attempts and preserves an existing lock", (t) => {
  const f = fixture(t),
    lock = path.join(f.root, ".fracto-managed/cold-boot-recovery.lock");
  with_managed_recovery_lock(f.root, () =>
    assert.throws(() => with_managed_recovery_lock(f.root, () => {}), /locked/),
  );
  assert.equal(fs.existsSync(lock), false);
  fs.writeFileSync(lock, "unknown-owner");
  assert.throws(() => with_managed_recovery_lock(f.root, () => {}), /locked/);
  assert.equal(fs.readFileSync(lock, "utf8"), "unknown-owner");
});
