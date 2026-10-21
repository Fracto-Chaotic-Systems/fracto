/** Match a dump's original columns, preserving columns added by migrations. */
export function backup_insert_columns(dump, table, target_columns) {
  const name = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const definition = dump.match(
    new RegExp("CREATE TABLE `" + name + "` \\(([\\s\\S]*?)\\) ENGINE", "i"),
  );
  if (!definition) throw Error(`Missing CREATE TABLE definition for ${table}`);
  const columns = [...definition[1].matchAll(/^\s*`([^`]+)`\s/gm)].map(
    (match) => match[1],
  );
  const targets = new Set(target_columns);
  if (!columns.length || columns.some((column) => !targets.has(column)))
    throw Error(`Backup columns do not match ${table}`);
  return columns;
}
