import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  migration_checksums,
  canonical_migration_history,
} from "../utils/migration_checksums.js";
const hash = (v) => createHash("sha256").update(v).digest("hex");
const sql = "-- Migration\nCREATE TABLE example (id INT PRIMARY KEY);\n";
test("LF and CRLF SQL share a canonical fingerprint and recognize both legacy histories", () => {
  const crlf = sql.replaceAll("\n", "\r\n");
  const lf_info = migration_checksums(sql),
    crlf_info = migration_checksums(crlf);
  assert.equal(lf_info.canonical, crlf_info.canonical);
  for (const info of [lf_info, crlf_info])
    for (const checksum of [hash(sql), hash(crlf)])
      assert.equal(info.accepted.has(checksum), true);
});
test("genuine SQL changes, whitespace, and comments keep distinct fingerprints", () => {
  const original = migration_checksums(sql);
  for (const changed of [
    sql.replace("INT", "BIGINT"),
    sql + "-- changed\n",
    sql.replace("CREATE TABLE", "CREATE  TABLE"),
  ]) {
    assert.equal(original.accepted.has(hash(changed)), false);
    assert.notEqual(original.canonical, migration_checksums(changed).canonical);
  }
});
test("history normalization requires byte proof and leaves unknown hashes and missing files unchanged", () => {
  const rows = [
    {
      version: "001_baseline.sql",
      checksum: hash(sql.replaceAll("\n", "\r\n")),
    },
    { version: "002_unknown.sql", checksum: "a".repeat(64) },
    { version: "003_missing.sql", checksum: "b".repeat(64) },
  ];
  const normalized = canonical_migration_history(rows, {
    read: (name) => {
      if (name === "003_missing.sql")
        throw Object.assign(Error("missing"), { code: "ENOENT" });
      return Buffer.from(sql);
    },
  });
  assert.equal(normalized[0].checksum, hash(sql));
  assert.equal(normalized[1].checksum, rows[1].checksum);
  assert.equal(normalized[2].checksum, rows[2].checksum);
  assert.notEqual(
    rows[0].checksum,
    normalized[0].checksum,
    "input history is not mutated",
  );
});
test("line-ending hashing preserves non-UTF8 bytes", () => {
  const bytes = Buffer.from([45, 45, 32, 255, 13, 10]);
  assert.equal(
    migration_checksums(bytes).canonical,
    hash(Buffer.from([45, 45, 32, 255, 10])),
  );
});
