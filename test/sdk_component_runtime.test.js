import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { create_component_document } from "@fracto/sdk/FractoComponentDocument.js";
import {
  component_runtime_json,
  validate_component_runtime,
  runtime_resource_path,
} from "@fracto/sdk/FractoComponentRuntime.js";
const fixture = () => ({
  schema_version: 1,
  source_revision: 17,
  source_document_sha256: "a".repeat(64),
  component: create_component_document(randomUUID(), "Published"),
  materials: [],
  files: [{ path: "NOTICE.txt", sha256: "b".repeat(64), bytes: 20 }],
});
test("runtime manifests are exact, canonical snapshots without authoring-only fields", () => {
  const value = fixture();
  assert.deepEqual(validate_component_runtime(value), value);
  const reordered = Object.fromEntries(Object.entries(value).reverse());
  assert.equal(
    component_runtime_json(value),
    component_runtime_json(reordered),
  );
  assert.throws(() =>
    validate_component_runtime({
      ...value,
      component: {
        ...value.component,
        construction_description: "Private authoring notes",
      },
    }),
  );
  assert.throws(() =>
    validate_component_runtime({ ...value, registry_url: "http://authoring" }),
  );
  assert.throws(() =>
    validate_component_runtime({
      ...value,
      files: [
        ...value.files,
        { path: "extra.bin", sha256: "c".repeat(64), bytes: 1 },
      ],
    }),
  );
  assert.throws(() => validate_component_runtime({ ...value, files: [] }));
  const changed = validate_component_runtime(value);
  changed.component.name = "Changed";
  assert.equal(value.component.name, "Published");
});
test("runtime resources reject traversal, external URLs and unbounded byte counts", () => {
  for (const path of [
    "../secret",
    "/absolute",
    "a/../b",
    "a\\b",
    "a/%2e%2e/b",
    "https://host/file",
    "a?query",
    "a#hash",
  ])
    assert.throws(() => runtime_resource_path(path));
  for (const bytes of [-1, 0, Infinity, 1024 * 1024 * 129])
    assert.throws(() =>
      validate_component_runtime({
        ...fixture(),
        files: [{ path: "NOTICE.txt", sha256: "a".repeat(64), bytes }],
      }),
    );
});
