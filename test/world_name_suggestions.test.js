import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  parse_name_suggestions,
  render_name_suggestions,
  suggestion_note,
} from "../scripts/world_name_suggestions.js";
import { load_mapping_rows } from "../scripts/wordnet_mapping_seed.js";
test("proposal covers every current world with distinct candidates and reproduces immutable migration", async () => {
  const mappings = await load_mapping_rows();
  const source = await readFile(
    new URL("../database/seeds/world-name-suggestions-v1.txt", import.meta.url),
    "utf8",
  );
  const rows = parse_name_suggestions(source, mappings);
  assert.equal(rows.length, 318);
  assert.equal(
    rows.reduce((sum, row) => sum + row.suggestions.length, 0),
    375,
  );
  assert.ok(
    rows.every(
      (row) => row.suggestions.length >= 1 && row.suggestions.length <= 3,
    ),
  );
  const sql = render_name_suggestions(rows);
  const committed = await readFile(
    new URL(
      "../database/migrations/006_world-name-suggestions.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal(
    sql.replaceAll("\r\n", "\n"),
    committed.replaceAll("\r\n", "\n"),
  );
  assert.doesNotMatch(sql, /SET\s+(?:mappings\.)?world_name/i);
  assert.match(sql, /LOCATE/);
  assert.ok(suggestion_note(rows[0]).includes("Cogito"));
});
test("proposal validation catches missing coverage, wrong senses, duplicates and too many alternatives", () => {
  const mappings = [
    { cardinality: 1, word: "existence", synset_id: "00000001" },
  ];
  for (const source of [
    "2|existence|Name|Reason",
    "1|wrong|Name|Reason",
    "1|existence|Name|Reason|Name|Reason",
    "1|existence|A|why|B|why|C|why|D|why",
  ])
    assert.throws(() => parse_name_suggestions(source, mappings));
});
