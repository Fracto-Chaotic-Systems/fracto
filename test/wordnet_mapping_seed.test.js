import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  build_mapping_rows,
  load_mapping_rows,
  mapping_factorization,
  render_mapping_migration,
} from "../scripts/wordnet_mapping_seed.js";

const entry = {
  cardinality: 6,
  synset_id: "00000001",
  label: "test",
  note: "A curated explanation",
};
const contender = {
  id: "00000001",
  label: "test",
  gloss: 'a definition; "an example"',
};

test("mapping rows preserve source senses and notes while extracting short definitions and factors", () => {
  const [row] = build_mapping_rows([entry], [contender]);
  assert.equal(row.synset_id, "00000001");
  assert.equal(row.definition, "a definition");
  assert.equal(row.gloss, contender.gloss);
  assert.equal(row.notes, entry.note);
  assert.equal(row.factorization, "2 x 3");
  assert.equal(mapping_factorization(1), "1");
  assert.equal(mapping_factorization(125), "5^3");
});
test("seed generation rejects duplicate, invalid and incomplete mappings", () => {
  assert.throws(
    () => build_mapping_rows([entry, entry], [contender]),
    /Duplicate/,
  );
  assert.throws(
    () => build_mapping_rows([{ ...entry, cardinality: -1 }], [contender]),
    /cardinality/,
  );
  assert.throws(() => build_mapping_rows([entry], []), /source sense/);
  assert.throws(
    () => build_mapping_rows([{ ...entry, note: "" }], [contender]),
    /note/,
  );
});
test("migration contains the exact 318-entry snapshot and safely encodes SQL-sensitive text", async () => {
  const rows = await load_mapping_rows();
  assert.equal(rows.length, 318);
  assert.equal(new Set(rows.map((row) => row.cardinality)).size, 318);
  assert.equal(new Set(rows.map((row) => row.synset_id)).size, 318);
  const license = await readFile(
    new URL("../servers/fracto-ui/public/wordnet/LICENSE.txt", import.meta.url),
    "utf8",
  );
  const committed = await readFile(
    new URL("../database/migrations/004_wordnet-mappings.sql", import.meta.url),
    "utf8",
  );
  assert.equal(
    committed.replaceAll("\r\n", "\n"),
    render_mapping_migration(rows, license).replaceAll("\r\n", "\n"),
  );
  const special = "O'Brien \\ line\n\u03bb";
  const sql = render_mapping_migration(
    [{ ...rows[0], notes: special }],
    license,
  );
  assert.ok(sql.includes(Buffer.from(special, "utf8").toString("hex")));
  assert.match(
    sql,
    /ON DUPLICATE KEY UPDATE cardinality = wordnet_mappings.cardinality/,
  );
});
