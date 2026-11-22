import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { repository_inventory } from "../scripts/repository_inventory.js";
import { ALL_SERVICES } from "@fracto/sdk/utils/PlatformConstants.js";

import {
  find_diverged_repositories,
  reset_diverged_repositories,
} from "../scripts/update_repositories.js";

test("repository updater identifies histories that diverged on both sides", () => {
  const ready = [
    { repository: { name: "behind" }, upstream: "origin/main" },
    { repository: { name: "ahead" }, upstream: "origin/main" },
    { repository: { name: "diverged" }, upstream: "origin/main" },
  ];
  const git_runner = (repository, args) => {
    const is_head_ancestor = args.at(-1) === "origin/main";
    const status =
      repository.name === "diverged"
        ? 1
        : repository.name === "ahead"
          ? is_head_ancestor
            ? 1
            : 0
          : is_head_ancestor
            ? 0
            : 1;
    return { status };
  };

  assert.deepEqual(
    find_diverged_repositories(ready, git_runner).map(
      (item) => item.repository.name,
    ),
    ["diverged"],
  );
});

test("declining the reset confirmation leaves all repository refs untouched", () => {
  const commands = [];
  const diverged = [
    { repository: { name: "fracto" }, upstream: "origin/main" },
  ];
  const git_runner = (...args) => commands.push(args);

  assert.equal(reset_diverged_repositories(diverged, "no", git_runner), false);
  assert.deepEqual(commands, []);
});

test("the exact RESET confirmation moves only divergent branches to upstream", () => {
  const commands = [];
  const diverged = [
    { repository: { name: "fracto" }, upstream: "origin/main" },
    { repository: { name: "fracto-data-server" }, upstream: "origin/main" },
  ];
  const git_runner = (...args) => commands.push(args);

  assert.equal(
    reset_diverged_repositories(diverged, "RESET", git_runner),
    true,
  );
  assert.deepEqual(
    commands.map(([, args]) => args),
    [
      ["reset", "--hard", "origin/main"],
      ["reset", "--hard", "origin/main"],
    ],
  );
});

test("pre-install repository inventory covers the same services as the runtime", () => {
  assert.deepEqual(
    repository_inventory()
      .slice(1)
      .map((item) => item.name),
    ALL_SERVICES.map((item) => item.name),
  );
});

test("repository updates and build metadata work without an SDK checkout or node_modules", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fracto-bootstrap-"));
  t.after(() => {
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
    );
    assert.ok(path.basename(directory).startsWith("fracto-bootstrap-"));
    fs.rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });
  const root = path.join(directory, "checkout");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(directory, "remotes"));
  const source = path.resolve(import.meta.dirname, "..");
  fs.copyFileSync(
    path.join(source, "package.json"),
    path.join(root, "package.json"),
  );
  fs.copyFileSync(
    path.join(source, "constants.js"),
    path.join(root, "constants.js"),
  );
  for (const file of [
    "update_repositories.js",
    "write_build_info.js",
    "repository_inventory.js",
  ]) {
    fs.copyFileSync(
      path.join(source, "scripts", file),
      path.join(root, "scripts", file),
    );
  }
  fs.writeFileSync(
    path.join(root, ".gitignore"),
    "servers/\nbuild-info.json\n",
  );
  const environment = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: path.join(directory, "gitconfig"),
    GIT_TERMINAL_PROMPT: "0",
  };
  const run = (command, args, cwd) => {
    const result = spawnSync(command, args, {
      cwd,
      env: environment,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return result.stdout.trim();
  };
  const git = (cwd, ...args) =>
    run(
      "git",
      [
        "-c",
        "user.name=Bootstrap fixture",
        "-c",
        "user.email=bootstrap@example.invalid",
        ...args,
      ],
      cwd,
    );
  const repositories = repository_inventory(root);
  for (const repository of repositories) {
    fs.mkdirSync(repository.directory, { recursive: true });
    fs.writeFileSync(
      path.join(repository.directory, "README.md"),
      `Synthetic ${repository.name} fixture.\n`,
    );
    const remote = path.join(directory, "remotes", repository.name + ".git");
    git(root, "init", "--bare", remote);
    git(repository.directory, "init", "--initial-branch=main");
    git(repository.directory, "add", ".");
    git(repository.directory, "commit", "--quiet", "-m", "Initial fixture");
    git(repository.directory, "remote", "add", "origin", remote);
    git(
      repository.directory,
      "push",
      "--quiet",
      "--set-upstream",
      "origin",
      "main",
    );
  }
  assert.equal(fs.existsSync(path.join(root, "node_modules")), false);
  assert.equal(fs.existsSync(path.join(root, "sdk")), false);
  // The runtime facade is present, but importing it would require the missing SDK.
  assert.equal(fs.existsSync(path.join(root, "constants.js")), true);
  assert.match(
    run(process.execPath, ["scripts/update_repositories.js"], root),
    /Repository update phase complete/,
  );
  run(process.execPath, ["scripts/write_build_info.js"], root);
  const info = JSON.parse(
    fs.readFileSync(path.join(root, "build-info.json"), "utf8"),
  );
  assert.deepEqual(
    Object.keys(info.repositories),
    repositories.map((item) => item.name),
  );
  for (const repository of repositories) {
    assert.equal(info.repositories[repository.name].branch, "main");
    assert.ok(info.repositories[repository.name].revision);
    assert.equal(info.repositories[repository.name].dirty, false);
    assert.equal(git(repository.directory, "status", "--porcelain"), "");
  }
});

test("repository inventory rejects duplicate and escaping deployment names", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fracto-inventory-"));
  t.after(() => {
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
    );
    assert.ok(path.basename(directory).startsWith("fracto-inventory-"));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  for (const serviceRepositories of [
    undefined,
    [],
    ["../outside"],
    ["fracto-ui", "fracto-ui"],
  ]) {
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ fracto: { serviceRepositories } }),
    );
    assert.throws(() => repository_inventory(directory), /serviceRepositories/);
  }
});
