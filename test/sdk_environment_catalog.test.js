import test from "node:test";
import assert from "node:assert/strict";
import {
  environment_registration,
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
