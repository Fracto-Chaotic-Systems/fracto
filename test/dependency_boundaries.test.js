import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  dependency_violation,
  inspect_dependency_imports,
  audit_dependency_boundaries,
} from "../scripts/dependency_boundaries.js";

const root = path.resolve("boundary-fixture");
const file = (name) => path.join(root, name);
test("dependency ownership requires endpoint boundaries and package-only SDK use", () => {
  assert.ok(
    dependency_violation(root, file("index.js"), "./servers/one/index.js"),
  );
  assert.ok(dependency_violation(root, file("index.js"), "./sdk/Example.js"));
  assert.ok(
    dependency_violation(root, file("servers/one/index.js"), "../../utils.js"),
  );
  assert.ok(
    dependency_violation(root, file("servers/one/index.js"), "../two/index.js"),
  );
  assert.ok(dependency_violation(root, file("sdk/Example.js"), "../index.js"));
  assert.ok(
    dependency_violation(root, file("index.js"), "service-one", {
      "service-one": "one",
    }),
  );
  for (const owner of ["index.js", "servers/one/index.js"])
    assert.equal(
      dependency_violation(root, file(owner), "@fracto/sdk/Example.js"),
      null,
    );
  assert.equal(
    dependency_violation(root, file("servers/one/index.js"), "./own.js"),
    null,
  );
  assert.equal(
    dependency_violation(root, file("sdk/Example.js"), "./Other.js"),
    null,
  );
});
test("parser detects executable import forms without matching comments or strings", () => {
  const source = `import './servers/one/index.js';
export * from './servers/two/index.js';
const a = import('./sdk/A.js');
const b = require('./servers/one/helper.cjs');
// import './servers/comment/index.js';
const ignored = "import './servers/string/index.js'";`;
  const findings = inspect_dependency_imports(source, file("index.js"), root);
  assert.equal(findings.length, 4);
  assert.deepEqual(findings.map((f) => f.line).sort(), [1, 2, 3, 4]);
});

test("source directories named tiles, instruments and public remain audited", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "fracto-boundaries-"),
  );
  try {
    for (const name of ["tiles", "instruments", "public"]) {
      const folder = path.join(directory, "servers", "one", name);
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(
        path.join(folder, "bad.js"),
        "export * from '../../../two/private.js';",
      );
    }
    assert.equal(audit_dependency_boundaries(directory).length, 3);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("filesystem URLs cannot bypass SDK package exports", () => {
  const findings = inspect_dependency_imports(
    'new URL("./sdk/Example.js", import.meta.url)',
    file("index.js"),
    root,
  );
  assert.equal(findings.length, 1);
  assert.equal(
    inspect_dependency_imports(
      'new URL(import.meta.resolve("@fracto/sdk/Example.js"))',
      file("index.js"),
      root,
    ).length,
    0,
  );
});
