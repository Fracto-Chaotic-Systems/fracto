const suggestions_version = "006_world-name-suggestions.sql";
const marker = `CONVERT(0x${Buffer.from("World name suggestions (unapproved):", "utf8").toString("hex")} USING utf8mb4)`;
const original_guard = `WHERE LOCATE(${marker}, mappings.notes) = 0;`;
const compatible_guard = `WHERE LOCATE(${marker} COLLATE utf8mb4_unicode_ci, mappings.notes COLLATE utf8mb4_unicode_ci) = 0;`;

/** Adapt only the execution copy of immutable migration 006. A derived CONVERT
 * expression can inherit general_ci while notes uses unicode_ci. Explicit
 * Unicode comparison preserves the case-insensitive duplicate-marker guard.
 * Checksums must continue to be calculated from the original migration bytes. */
export function compatible_migration_sql(filename, sql) {
  if (filename !== suggestions_version) return sql;
  if (!sql.includes(original_guard))
    throw new Error("Migration 006 compatibility guard was not found");
  return sql.replace(original_guard, compatible_guard);
}
