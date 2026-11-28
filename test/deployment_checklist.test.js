import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CHECKLIST_PATH,
  check_checklist,
  collect_deployment_todos,
} from "../scripts/deployment_checklist.js";

const library = (t, records) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fracto-checklist-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const assets = [];
  for (const [id, record] of Object.entries(records)) {
    fs.mkdirSync(path.join(directory, id));
    fs.writeFileSync(
      path.join(directory, id, "asset.json"),
      JSON.stringify(record),
    );
    assets.push({ id, record: `${id}/asset.json` });
  }
  fs.writeFileSync(
    path.join(directory, "catalog.json"),
    JSON.stringify({ assets }),
  );
  return directory;
};

test("asset deployment todos are collected and matched to checklist lines", (t) => {
  const directory = library(t, {
    "stone-a": {
      deployment_todo: [
        { id: "authentic-texture", added: "2026-11-28", item: "Texture" },
      ],
    },
    "stone-b": {
      deployment_todo: [{ id: "license-decision", item: "License" }],
    },
    plain: {},
  });
  const todos = collect_deployment_todos(directory);
  assert.deepEqual(
    todos.map((todo) => `${todo.asset}:${todo.id}`),
    ["stone-a:authentic-texture", "stone-b:license-decision"],
  );
  const listed = check_checklist(
    "- [ ] `stone-a` · authentic-texture — x\n- [ ] `stone-b` · license-decision — y\n- [ ] other",
    todos,
  );
  assert.deepEqual(
    [listed.missing, listed.checked_but_open, listed.open],
    [[], [], 3],
  );
  const partial = check_checklist(
    "- [x] `stone-a` · authentic-texture — done",
    todos,
  );
  assert.deepEqual(
    partial.missing.map((todo) => todo.asset),
    ["stone-b"],
  );
  assert.deepEqual(
    partial.checked_but_open.map((todo) => todo.asset),
    ["stone-a"],
  );
  // An id must match whole, not as part of a longer id.
  assert.equal(
    check_checklist("- [ ] `stone-a` · authentic-texture-v2", todos.slice(0, 1))
      .missing.length,
    1,
  );
});

test("invalid deployment_todo entries are rejected", (t) => {
  const directory = library(t, { bad: { deployment_todo: [{ id: 3 }] } });
  assert.throws(
    () => collect_deployment_todos(directory),
    /Invalid deployment_todo/,
  );
});

test("the repository checklist lists every asset record item", () => {
  const result = check_checklist(
    fs.readFileSync(CHECKLIST_PATH, "utf8"),
    collect_deployment_todos(),
  );
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.checked_but_open, []);
});
