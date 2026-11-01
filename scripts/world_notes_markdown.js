import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const marker = "World name suggestions (unapproved):";

// Formatting only: no rewriting, reordering, or interpretation of editorial text.
export function format_world_notes(notes) {
  if (!notes.includes(marker) || notes.includes(`### ${marker}`)) return notes;
  let candidate = false;
  return notes
    .split(/\r?\n/)
    .map((line) => {
      if (line === marker) return `### ${marker}`;
      const suggestion = line.match(/^- ([^:]+):(.*)$/);
      if (suggestion) {
        candidate = true;
        return `\n- **${suggestion[1]}:**${suggestion[2]}`;
      }
      const detail = line.match(/^  ([^:]+):(.*)$/);
      if (candidate && detail) {
        return `\n  - **${detail[1]}:**${detail[2]}`;
      }
      return line;
    })
    .join("\n");
}

// Assert that the formatting pass preserved every word, reference and ordering.
export function editorial_content(notes) {
  return notes
    .replace(/^### /gm, "")
    .replace(/^  - /gm, "  ")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function request(path, body) {
  return JSON.parse(
    execFileSync(
      "curl",
      [
        "--fail-with-body",
        "--silent",
        "--show-error",
        ...(body ? ["--json", "@-"] : []),
        `http://127.0.0.1:3102${path}`,
      ],
      { input: body ? JSON.stringify(body) : undefined, encoding: "utf8" },
    ),
  );
}

function main() {
  const apply = process.argv.includes("--apply");
  const rows = request("/wordnet_mappings").result;
  assert.ok(Array.isArray(rows) && rows.length);
  const changes = rows
    .map((row) => ({ row, notes: format_world_notes(row.notes) }))
    .filter(({ row, notes }) => row.notes !== notes);
  for (const { row, notes } of changes) {
    assert.equal(editorial_content(notes), editorial_content(row.notes));
    assert.equal(format_world_notes(notes), notes);
    assert.ok(Buffer.byteLength(notes, "utf8") <= 65535);
  }
  let backup;
  if (apply && changes.length) {
    const index = process.argv.indexOf("--backup");
    assert.ok(
      index >= 0 && process.argv[index + 1],
      "--apply requires --backup PATH",
    );
    backup = process.argv[index + 1];
    writeFileSync(backup, JSON.stringify(rows, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    for (const { row, notes } of changes) {
      request("/data/request", {
        operation: "update",
        table: "wordnet_mappings",
        key: { cardinality: row.cardinality },
        values: { notes },
        expected: { notes: row.notes },
      });
    }
    const after = request("/wordnet_mappings").result;
    assert.equal(after.length, rows.length);
    for (const row of rows) {
      const saved = after.find(
        (entry) => entry.cardinality === row.cardinality,
      );
      assert.deepEqual(saved, { ...row, notes: format_world_notes(row.notes) });
    }
  }
  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "preview",
      total: rows.length,
      changed: changes.length,
      backup,
      sample: changes
        .slice(0, 2)
        .map(({ row, notes }) => ({ cardinality: row.cardinality, notes })),
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
