import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

export const valid_id = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const valid_image = (value) =>
  typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
export const valid_name = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,220}$/.test(value);

export function validate_registration(registry) {
  const value = registry?.current;
  if (
    registry?.schema_version !== 1 ||
    !valid_id(value?.container_id) ||
    !valid_image(value?.image_id) ||
    !valid_name(value?.name)
  )
    throw Error("Invalid managed production registration");
  return value;
}

export function managed_docker(root, run = spawnSync) {
  const execute = (args) => {
    const result = run("docker", args, {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 16 * 1024 ** 2,
      windowsHide: true,
      shell: false,
    });
    if (result.error || result.status !== 0)
      throw Error(
        `Docker ${args.slice(0, 2).join(" ")} failed; managed recovery stopped`,
      );
    return result.stdout.trim();
  };
  const inspect = (id) => {
    if (!valid_id(id)) throw Error("Invalid managed container ID");
    const value = JSON.parse(
      execute(["container", "inspect", "--format", "{{json .}}", id]),
    );
    if (
      value.Id !== id ||
      !valid_image(value.Image) ||
      !value.Name?.startsWith("/")
    )
      throw Error("Docker container identity did not match the requested ID");
    return value;
  };
  return {
    inspect,
    named(name) {
      if (!valid_name(name)) throw Error("Invalid managed container name");
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const ids = execute([
        "container",
        "ls",
        "--all",
        "--no-trunc",
        "--filter",
        `name=^/${escaped}$`,
        "--format",
        "{{.ID}}",
      ]);
      if (!ids) return null;
      if (!valid_id(ids)) throw Error("Ambiguous Docker container name");
      const value = inspect(ids);
      if (value.Name !== "/" + name)
        throw Error("Docker container name did not match the requested name");
      return value;
    },
    rename(id, name) {
      if (!valid_id(id) || !valid_name(name))
        throw Error("Invalid retained container identity");
      execute(["container", "rename", id, name]);
    },
  };
}

function json_file(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > 1024 ** 2)
    throw Error("Invalid managed recovery metadata");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function journal_directory(root, registry) {
  const captures = fs.realpathSync(
    registry.capture_directory ||
      path.join(root, ".fracto-managed", "captures"),
  );
  const directory = fs.realpathSync(registry.latest_operation);
  if (
    path.dirname(directory) !== captures ||
    !/^managed-upgrade-[a-zA-Z0-9-]+$/.test(path.basename(directory))
  )
    throw Error(
      "Managed operation is outside its registered capture directory",
    );
  return { captures, directory };
}

// Ownership requires a journal's exact ID/image pair, or its exact Compose
// project/service labels AND immutable candidate image. A name alone is no proof.
function journal_owns(container, journal, directory) {
  if (
    (journal.old_container_id === container.Id &&
      journal.old_image_id === container.Image) ||
    (journal.candidate_container_id === container.Id &&
      journal.candidate_image_id === container.Image) ||
    (journal.previous?.container_id === container.Id &&
      journal.previous?.image_id === container.Image)
  )
    return true;
  if (journal.candidate_image_id !== container.Image) return false;
  let compose;
  try {
    compose = json_file(path.join(directory, "compose.production.json"));
  } catch {
    return false;
  }
  const labels = container.Config?.Labels || {};
  return (
    typeof compose.name === "string" &&
    labels["com.docker.compose.project"] === compose.name &&
    Object.entries(compose.services || {}).some(
      ([service, config]) =>
        labels["com.docker.compose.service"] === service &&
        config.image === container.Image &&
        config.container_name === (journal.production_name || journal.old_name),
    )
  );
}

function known_container(container, captures) {
  const directories = fs.readdirSync(captures, { withFileTypes: true });
  if (directories.length > 1000)
    throw Error(
      "Too many retained operations to verify container ownership automatically",
    );
  return directories.some((entry) => {
    if (
      !entry.isDirectory() ||
      !/^managed-upgrade-[a-zA-Z0-9-]+$/.test(entry.name)
    )
      return false;
    const directory = path.join(captures, entry.name);
    let journal;
    try {
      journal = json_file(path.join(directory, "journal.json"));
    } catch {
      return false;
    }
    return journal_owns(container, journal, directory);
  });
}

export function assert_registered_container(registry, docker) {
  const expected = validate_registration(registry),
    actual = docker.inspect(expected.container_id);
  if (actual.Image !== expected.image_id || actual.Name !== "/" + expected.name)
    throw Error(
      "Managed production identity differs from its registration; automatic recovery needs a matching retained upgrade journal",
    );
  return actual;
}

function retain_failed_collision({
  expected,
  docker,
  captures,
  directory,
  unchanged,
  log,
}) {
  const collision = docker.named(expected.name + "-failed");
  if (!collision) return;
  if (
    collision.Id === expected.container_id ||
    collision.State?.Running !== false ||
    !["exited", "created"].includes(collision.State?.Status) ||
    !known_container(collision, captures)
  )
    throw Error(
      "Failed-container name is occupied by an active or unverified container; no container was changed",
    );
  const retained_name =
    expected.name.slice(0, 170) +
    "-failed-retained-" +
    collision.Id.slice(0, 16);
  if (docker.named(retained_name))
    throw Error(
      "Retained-container destination is already occupied; no container was changed",
    );
  const latest = docker.inspect(collision.Id);
  if (
    latest.Name !== collision.Name ||
    latest.Image !== collision.Image ||
    latest.State?.Running !== false ||
    !["exited", "created"].includes(latest.State?.Status) ||
    !unchanged()
  )
    throw Error("Managed recovery state changed during verification");
  const record = (event) =>
    fs.appendFileSync(
      path.join(directory, "cold-boot-recovery.jsonl"),
      JSON.stringify({
        event,
        container_id: collision.Id,
        image_id: collision.Image,
        previous_name: collision.Name.slice(1),
        retained_name,
      }) + "\n",
    );
  record("retain-planned");
  docker.rename(collision.Id, retained_name);
  const renamed = docker.inspect(collision.Id);
  if (renamed.Name !== "/" + retained_name || renamed.Image !== collision.Image)
    throw Error("Retained-container rename could not be verified");
  record("retained");
  log(
    "Preserved a stopped, journal-verified failed container under a unique retained name.",
  );
}

/** Resume the controller's rollback after resolving only proven, stopped name collisions. */
export function recover_managed_production({
  root,
  docker = managed_docker(root),
  rollback,
  log = console.log,
  mode = "prod",
}) {
  const file = path.join(root, ".fracto-production.json"),
    registry_source = fs.readFileSync(file, "utf8"),
    registry = json_file(file);
  const expected = validate_registration(registry);
  const stable = () => {
    const current = assert_registered_container(registry, docker);
    if (mode === "prod")
      retain_failed_collision({
        expected,
        docker,
        captures: path.resolve(
          root,
          registry.capture_directory || ".fracto-managed/captures",
        ),
        directory: path.join(root, ".fracto-managed"),
        unchanged: () => registry_source === fs.readFileSync(file, "utf8"),
        log,
      });
    return current;
  };
  if (!registry.latest_operation) return stable();
  const { captures, directory } = journal_directory(root, registry);
  const journal_path = path.join(directory, "journal.json"),
    journal_source = fs.readFileSync(journal_path, "utf8"),
    journal = json_file(journal_path);
  const unchanged = () =>
    registry_source === fs.readFileSync(file, "utf8") &&
    journal_source === fs.readFileSync(journal_path, "utf8");
  const incomplete =
    journal.phase === "rollback_requires_attention" ||
    (journal.old_stop_requested === true &&
      !["promoted", "rolled_back"].includes(journal.phase));
  if (!incomplete) return stable();
  if (mode !== "prod")
    throw Error(
      "Managed production has an incomplete upgrade; recover it with cold_boot.bat prod before starting development",
    );
  if (
    journal.old_container_id !== expected.container_id ||
    journal.old_image_id !== expected.image_id ||
    journal.old_name !== expected.name ||
    journal.previous?.container_id !== expected.container_id ||
    journal.previous?.image_id !== expected.image_id ||
    journal.previous?.name !== expected.name ||
    (journal.production_name && journal.production_name !== expected.name)
  )
    throw Error(
      "Incomplete upgrade does not match the registered previous production identity",
    );
  const old = docker.inspect(expected.container_id),
    suffix = path.basename(directory).slice("managed-upgrade-".length);
  if (
    old.Image !== expected.image_id ||
    ![
      "/" + expected.name,
      "/" + expected.name + "-rollback-" + suffix,
    ].includes(old.Name)
  )
    throw Error(
      "Previous production container differs from the retained rollback identity",
    );
  const active = docker.named(expected.name);
  if (
    active &&
    active.Id !== old.Id &&
    !journal_owns(active, journal, directory)
  )
    throw Error(
      "Production name is occupied by an unverified container; no container was changed",
    );
  retain_failed_collision({
    expected,
    docker,
    captures,
    directory,
    unchanged,
    log,
  });
  if (!unchanged())
    throw Error(
      "Managed upgrade journal changed before recovery; cold boot stopped",
    );
  log("Resuming the recorded managed-production rollback before rebuilding...");
  const code = rollback();
  if (code !== 0)
    throw Error(
      `Managed rollback failed (${code}); cold boot stopped. Retained journal: ${directory}`,
    );
  const restored_registry = json_file(file),
    restored = assert_registered_container(restored_registry, docker);
  if (
    restored.Id !== old.Id ||
    restored.Image !== old.Image ||
    restored_registry.latest_operation ||
    !restored.State?.Running
  )
    throw Error(
      "Rollback did not restore the recorded running production container",
    );
  const restored_source = fs.readFileSync(file, "utf8");
  retain_failed_collision({
    expected: validate_registration(restored_registry),
    docker,
    captures,
    directory: path.join(root, ".fracto-managed"),
    unchanged: () => restored_source === fs.readFileSync(file, "utf8"),
    log,
  });
  log(
    "Recovered previous production. All containers and volumes were retained.",
  );
  return restored;
}

export function with_managed_recovery_lock(root, callback) {
  const file = path.join(root, ".fracto-managed", "cold-boot-recovery.lock"),
    token = `${process.pid}:${randomUUID()}`;
  let descriptor;
  try {
    descriptor = fs.openSync(file, "wx");
  } catch (error) {
    if (error.code === "EEXIST")
      throw Error(
        "Managed recovery is locked by another or interrupted invocation; inspect cold-boot-recovery.lock before retrying",
      );
    throw error;
  }
  try {
    fs.writeFileSync(descriptor, token);
    return callback();
  } finally {
    fs.closeSync(descriptor);
    if (fs.readFileSync(file, "utf8") === token) fs.unlinkSync(file);
  }
}
