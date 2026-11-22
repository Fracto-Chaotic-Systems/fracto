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
