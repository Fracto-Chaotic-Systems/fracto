import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  EMPTY_CONSTRUCTION_MEMORY,
  validate_construction_memory,
  validate_construction_guidance,
  edit_construction_memory,
  delete_construction_pattern,
  select_construction_patterns,
} from "@fracto/sdk/FractoConstructionMemory.js";
const pattern = (extra = {}) => ({
  id: randomUUID(),
  revision: 1,
  kind: "preference",
  title: "Open paths",
  instructions: "Keep walking corridors clear.",
  keywords: ["path"],
  enabled: true,
  ...extra,
});
test("explicit memory supports immutable revision-checked create, inspect, edit and delete", () => {
  const item = pattern();
  let library = edit_construction_memory(EMPTY_CONSTRUCTION_MEMORY, item);
  assert.equal(EMPTY_CONSTRUCTION_MEMORY.patterns.length, 0);
  const copy = validate_construction_memory(library);
  copy.patterns[0].title = "Other";
  assert.equal(library.patterns[0].title, "Open paths");
  library = edit_construction_memory(
    library,
    { ...item, revision: 2, instructions: "Use a 2m clear corridor." },
    1,
  );
  assert.throws(
    () => edit_construction_memory(library, { ...item, revision: 2 }, 1),
    /memory_conflict/,
  );
  assert.throws(
    () => delete_construction_pattern(library, item.id, 1),
    /memory_conflict/,
  );
  assert.equal(
    delete_construction_pattern(library, item.id, 2).patterns.length,
    0,
  );
});
test("matching uses explicit enabled flags and whole keywords, projecting no local identity", () => {
  const library = {
    schema_version: 1,
    patterns: [
      pattern(),
      pattern({
        kind: "recipe",
        title: "Ground",
        keywords: [],
        instructions: "Use a calibrated dirt floor.",
      }),
      pattern({ enabled: false }),
      pattern({ keywords: ["trees"] }),
    ],
  };
  const selected = select_construction_patterns(library, "A PATH, with shrubs");
  assert.equal(selected.patterns.length, 2);
  assert.deepEqual(selected.guidance.map(Object.keys), [
    ["kind", "instructions"],
    ["kind", "instructions"],
  ]);
  assert.equal(
    selected.guidance.some((item) =>
      JSON.stringify(item).includes(library.patterns[0].id),
    ),
    false,
  );
  assert.equal(
    select_construction_patterns(library, "pathway").patterns.length,
    1,
  );
  assert.equal(
    select_construction_patterns(
      delete_construction_pattern(library, library.patterns[0].id, 1),
      "path",
    ).patterns.length,
    1,
  );
});
test("memory rejects profile fields, unknown versions and unbounded libraries or guidance without dropping rules", () => {
  for (const item of [
    pattern({ account_id: "excluded" }),
    pattern({ kind: "inferred" }),
    pattern({ instructions: " " }),
    pattern({ keywords: ["two words"] }),
    pattern({ keywords: ["Path"] }),
    pattern({ instructions: "x".repeat(1001) }),
  ])
    assert.throws(
      () =>
        validate_construction_memory({ schema_version: 1, patterns: [item] }),
      /memory_invalid/,
    );
  assert.throws(
    () => validate_construction_memory({ schema_version: 2, patterns: [] }),
    /memory_invalid/,
  );
  assert.throws(
    () =>
      validate_construction_memory({
        schema_version: 1,
        patterns: Array.from({ length: 33 }, () => pattern()),
      }),
    /memory_invalid/,
  );
  assert.throws(
    () =>
      select_construction_patterns(
        {
          schema_version: 1,
          patterns: Array.from({ length: 4 }, () => pattern({ keywords: [] })),
        },
        "anything",
      ),
    /memory_guidance_limit/,
  );
  assert.throws(
    () =>
      validate_construction_guidance([
        { kind: "recipe", instructions: "x", id: randomUUID() },
      ]),
    /memory_guidance_limit/,
  );
  assert.throws(
    () =>
      validate_construction_guidance(
        Array.from({ length: 3 }, () => ({
          kind: "preference",
          instructions: "é".repeat(900),
        })),
      ),
    /memory_guidance_limit/,
  );
});
