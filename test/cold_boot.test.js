import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const batch_source = fs.readFileSync(
  new URL("../scripts/cold_boot.bat", import.meta.url),
  "utf8",
);

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fracto-cold-boot-"));
  t.after(() => {
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
    );
    assert.ok(path.basename(directory).startsWith("fracto-cold-boot-"));
    fs.rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });
  const root = path.join(directory, "checkout with spaces");
  const remote = path.join(directory, "upstream.git");
  const writer = path.join(directory, "writer");
  const trace = path.join(directory, "updater.json");
  const environment = {
    ...process.env,
    GIT_CONFIG_GLOBAL: path.join(directory, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    npm_config_cache: path.join(directory, "npm-cache"),
    FRACTO_COLD_BOOT_TEST_TRACE: trace,
  };
  delete environment.FRACTO_COLD_BOOT_TEST_REVISION;
  const git = (cwd, ...args) => {
    const result = spawnSync(
      "git",
      [
        "-c",
        "user.name=Cold boot fixture",
        "-c",
        "user.email=cold-boot@example.invalid",
        ...args,
      ],
      {
        cwd,
        env: environment,
        encoding: "utf8",
        windowsHide: true,
        timeout: 30000,
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout.trim();
  };
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "cold_boot.bat"), batch_source);
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      type: "module",
      scripts: { "update:repos": "node scripts/update_repositories.js" },
    }),
  );
  // Stop at the updater boundary: a real build/container must never start in this fixture.
  fs.writeFileSync(
    path.join(root, "scripts", "update_repositories.js"),
    `
import fs from 'node:fs';
fs.writeFileSync(process.env.FRACTO_COLD_BOOT_TEST_TRACE, JSON.stringify({
  revision: process.env.FRACTO_COLD_BOOT_TEST_REVISION,
  mode: process.env.cold_boot_mode,
  root_revision: fs.readFileSync('root-revision.txt', 'utf8'),
}));
process.exit(23);
`,
  );
  fs.writeFileSync(path.join(root, "root-revision.txt"), "initial");
  git(directory, "init", "--bare", remote);
  git(root, "init", "--initial-branch=main");
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "Initial fixture");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "--quiet", "--set-upstream", "origin", "main");
  const run = (mode) =>
    spawnSync(
      process.env.ComSpec || "cmd.exe",
      [
        "/d",
        "/s",
        "/c",
        `""${path.join(root, "scripts", "cold_boot.bat")}" ${mode}"`,
      ],
      {
        cwd: directory,
        env: environment,
        encoding: "utf8",
        windowsHide: true,
        windowsVerbatimArguments: true,
        timeout: 45000,
      },
    );
  return { root, remote, writer, trace, git, run };
}

test("cold boot fast-forwards the root before invoking the repository updater", () => {
  assert.ok(
    batch_source.indexOf("git pull --ff-only") <
      batch_source.indexOf("call npm run update:repos"),
  );
  assert.match(
    batch_source,
    /git pull --ff-only\r?\n\s+if errorlevel 1 goto failed/,
  );
});

for (const mode of ["prod", "dev"]) {
  test(
    `cold boot reloads a pulled batch file once and preserves ${mode} and updater failures`,
    { skip: process.platform !== "win32" },
    (t) => {
      const { root, remote, writer, trace, git, run } = fixture(t);
      git(root, "clone", "--quiet", "--branch", "main", remote, writer);
      // Shift every original byte offset, simulating an update to cold_boot.bat itself.
      fs.writeFileSync(
        path.join(writer, "scripts", "cold_boot.bat"),
        '@echo off\r\nset "FRACTO_COLD_BOOT_TEST_REVISION=updated"\r\n' +
          batch_source,
      );
      fs.writeFileSync(path.join(writer, "root-revision.txt"), "updated");
      git(writer, "add", ".");
      git(writer, "commit", "--quiet", "-m", "Update bootstrap and root input");
      git(writer, "push", "--quiet", "origin", "main");
      const result = run(mode);
      assert.equal(result.error, undefined);
      assert.equal(result.status, 23, result.stdout + result.stderr);
      assert.deepEqual(JSON.parse(fs.readFileSync(trace, "utf8")), {
        revision: "updated",
        mode,
        root_revision: "updated",
      });
      assert.equal(
        (result.stdout.match(/Pulling the root repository/g) || []).length,
        1,
      );
      assert.doesNotMatch(result.stdout, /Rebuilding the production image/);
      assert.equal(
        git(root, "rev-parse", "HEAD"),
        git(writer, "rev-parse", "HEAD"),
      );
    },
  );
}

test(
  "a failed root pull stops cold boot before the updater or image build",
  { skip: process.platform !== "win32" },
  (t) => {
    const { root, trace, git, run } = fixture(t);
    git(
      root,
      "remote",
      "set-url",
      "origin",
      path.join(root, "missing-upstream.git"),
    );
    const result = run("prod");
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(trace), false);
    assert.doesNotMatch(
      result.stdout,
      /Refreshing the root and service repositories|Rebuilding the production image/,
    );
  },
);
