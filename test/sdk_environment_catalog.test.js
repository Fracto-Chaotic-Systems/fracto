import test from "node:test";
import assert from "node:assert/strict";
import {
  environment_registration,
  normalize_model_folder,
  validate_catalog_edit,
  CATALOG_FIELDS,
  validate_environment_registration,
} from "@fracto/sdk/FractoEnvironmentCatalog.js";

test("shared registration contract excludes extensions and rejects unsafe provenance", () => {
  const registration = environment_registration(
    {
      schema_version: 1,
      id: "grass",
      name: "Grass",
      version: "1.0.0",
      description: "Grass model",
      attribution: {
        status: "unresolved",
        creator_name: "Creator",
        account: "excluded",
      },
      sources: [],
      runtime: {
        path: "runtime/grass.glb",
        format: "glb",
        private: "excluded",
      },
      history: [],
      private: "excluded",
    },
    "a".repeat(64),
  );
  assert.ok(!JSON.stringify(registration).includes("excluded"));
  assert.equal(validate_environment_registration(registration), registration);
  assert.throws(
    () =>
      validate_environment_registration({
        ...registration,
        account: "excluded",
      }),
    /invalid_record/,
  );
  const invalid = structuredClone(registration);
  invalid.record.attribution.source_url = "file:///private";
  assert.throws(
    () => validate_environment_registration(invalid),
    /invalid_url/,
  );
  invalid.record.attribution.source_url = null;
  invalid.record.runtime.extra = "not-allowed";
  assert.throws(
    () => validate_environment_registration(invalid),
    /invalid_record/,
  );
});

test("shared registration retains construction category independently of descriptive category", () => {
  const base = {
    id: "grass",
    name: "Grass",
    version: "1",
    description: "Grass",
    category: "vegetation/grass",
    model_category: "material",
    attribution: { status: "unresolved" },
    sources: [],
    history: [],
  };
  const registration = environment_registration(base, "a".repeat(64));
  assert.equal(registration.record.model_category, "material");
  assert.equal(registration.record.category, "vegetation/grass");
  for (const category of ["material", "component", "area"])
    assert.equal(
      validate_environment_registration(
        environment_registration(
          { ...base, model_category: category },
          "a".repeat(64),
        ),
      ).record.model_category,
      category,
    );
  assert.throws(
    () =>
      environment_registration(
        { ...base, model_category: "invalid" },
        "a".repeat(64),
      ),
    /invalid_record/,
  );
});

test("logical folder paths are portable and reject filesystem-like traversal", () => {
  assert.equal(normalize_model_folder(), "");
  assert.equal(
    normalize_model_folder(" Vegetation / Grasses "),
    "Vegetation/Grasses",
  );
  for (const value of [
    "../escape",
    "/absolute",
    "C:/private",
    "a//b",
    "a/./b",
    "a/../b",
    "a".repeat(65),
    Array(9).fill("a").join("/"),
    "a" + String.fromCharCode(92) + "b",
    "a" + String.fromCharCode(0) + "b",
    null,
    [],
  ])
    assert.throws(() => normalize_model_folder(value), /invalid_folder/);
  const body = {
    revision: "a".repeat(64),
    attribution: Object.fromEntries(CATALOG_FIELDS.map((key) => [key, null])),
    note: "",
  };
  assert.equal(
    validate_catalog_edit({ ...body, folder_path: "Vegetation/Grasses" })
      .folder_path,
    "Vegetation/Grasses",
  );
  assert.equal(
    Object.hasOwn(validate_catalog_edit(body), "folder_path"),
    false,
  );
});

test("model management validates action-specific bounded inputs and exact folder ancestry", async () => {
  const { validate_model_management, folder_contains } =
    await import("@fracto/sdk/FractoModelManagement.js");
  assert.equal(
    validate_model_management({
      action: "rename-model",
      id: "grass",
      revision: "a".repeat(64),
      name: " Grass ",
    }).name,
    "Grass",
  );
  assert.equal(
    validate_model_management({
      action: "rename-folder",
      category: "material",
      folder_path: "plants/herbs",
      name: "flowers",
    }).target,
    "plants/flowers",
  );
  assert.equal(folder_contains("plants", "plants2"), false);
  for (const body of [
    { action: "delete-folder", category: "material", folder_path: "" },
    { action: "delete-folder", category: "material", folder_path: "../plants" },
    {
      action: "rename-folder",
      category: "material",
      folder_path: "plants",
      name: "nested/name",
    },
    { action: "delete-model", id: "grass", revision: "old" },
    {
      action: "rename-model",
      id: "grass",
      revision: "a".repeat(64),
      name: " ",
    },
    {
      action: "rename-model",
      id: "grass",
      revision: "a".repeat(64),
      name: "x".repeat(256),
    },
    {
      action: "delete-model",
      id: "grass",
      revision: "a".repeat(64),
      name: "unexpected",
    },
    { action: "delete-folder", category: "unknown", folder_path: "plants" },
  ])
    assert.throws(() => validate_model_management(body));
});
