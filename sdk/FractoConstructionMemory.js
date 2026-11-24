// Pure contracts: local library identity never enters planner guidance.
const fail = (code = "memory_invalid") => {
  throw new Error(code);
};
const exact = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const text = (value, max) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= max &&
  !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
export const EMPTY_CONSTRUCTION_MEMORY = { schema_version: 1, patterns: [] };
export function validate_construction_pattern(value) {
  if (
    !exact(value, [
      "id",
      "revision",
      "kind",
      "title",
      "instructions",
      "keywords",
      "enabled",
    ]) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      value.id,
    ) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !["preference", "recipe"].includes(value.kind) ||
    !text(value.title, 80) ||
    !text(value.instructions, 1000) ||
    typeof value.enabled !== "boolean" ||
    !Array.isArray(value.keywords) ||
    value.keywords.length > 6 ||
    value.keywords.some(
      (word) =>
        typeof word !== "string" ||
        !/^[\p{L}\p{N}]{1,24}$/u.test(word) ||
        word !== word.toLowerCase(),
    ) ||
    new Set(value.keywords).size !== value.keywords.length
  )
    fail();
  return structuredClone(value);
}
export function validate_construction_memory(value) {
  if (
    !exact(value, ["schema_version", "patterns"]) ||
    value.schema_version !== 1 ||
    !Array.isArray(value.patterns) ||
    value.patterns.length > 32
  )
    fail();
  const patterns = value.patterns.map(validate_construction_pattern);
  if (
    new Set(patterns.map((item) => item.id)).size !== patterns.length ||
    JSON.stringify(value).length > 65536
  )
    fail();
  return { schema_version: 1, patterns };
}
export function edit_construction_memory(
  library,
  pattern,
  expected_revision = 0,
) {
  const next = validate_construction_memory(library),
    checked = validate_construction_pattern(pattern);
  const index = next.patterns.findIndex((item) => item.id === checked.id),
    previous = next.patterns[index];
  if (
    (previous?.revision || 0) !== expected_revision ||
    checked.revision !== expected_revision + 1
  )
    fail("memory_conflict");
  if (index < 0) next.patterns.push(checked);
  else next.patterns[index] = checked;
  return validate_construction_memory(next);
}
export function delete_construction_pattern(library, id, expected_revision) {
  const next = validate_construction_memory(library),
    previous = next.patterns.find((item) => item.id === id);
  if (!previous || previous.revision !== expected_revision)
    fail("memory_conflict");
  next.patterns = next.patterns.filter((item) => item.id !== id);
  return next;
}
export function validate_construction_guidance(value) {
  if (
    !Array.isArray(value) ||
    value.length > 3 ||
    value.some(
      (item) =>
        !exact(item, ["kind", "instructions"]) ||
        !["preference", "recipe"].includes(item.kind) ||
        !text(item.instructions, 1000),
    ) ||
    new TextEncoder().encode(JSON.stringify(value)).length > 2400
  )
    fail("memory_guidance_limit");
  return structuredClone(value);
}
export function select_construction_patterns(library, brief) {
  const tokens = new Set(
    String(brief)
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) || [],
  );
  const patterns = validate_construction_memory(library).patterns.filter(
    (item) =>
      item.enabled &&
      (!item.keywords.length || item.keywords.some((word) => tokens.has(word))),
  );
  const guidance = validate_construction_guidance(
    patterns.map(({ kind, instructions }) => ({ kind, instructions })),
  );
  return { patterns, guidance };
}
