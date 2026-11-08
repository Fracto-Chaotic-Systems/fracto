import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const default_directory = fileURLToPath(
  new URL("../database/migrations/", import.meta.url),
);

/** Canonical LF fingerprint, plus exact legacy LF/CRLF byte fingerprints.
 * No trimming, comment removal, Unicode decoding, or SQL rewriting occurs. */
export function migration_checksums(contents) {
  const raw = Buffer.from(contents),
    normalized = Buffer.allocUnsafe(raw.length);
  let length = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 13 && raw[i + 1] === 10) continue;
    normalized[length++] = raw[i];
  }
  const lf = normalized.subarray(0, length);
  let newlines = 0;
  for (const byte of lf) if (byte === 10) newlines++;
  const crlf = Buffer.allocUnsafe(lf.length + newlines);
  let offset = 0;
  for (const byte of lf) {
    if (byte === 10) crlf[offset++] = 13;
    crlf[offset++] = byte;
  }
  const canonical = sha256(lf);
  return {
    canonical,
    accepted: new Set([sha256(raw), canonical, sha256(crlf)]),
  };
}

/** Normalize only checksums proven to match local SQL bytes with different
 * line endings. Unknown/missing migrations retain their exact fingerprint. */
export function canonical_migration_history(
  rows,
  {
    directory = process.env.FRACTO_DB_MIGRATION_DIR || default_directory,
    read = (filename) => fs.readFileSync(path.join(directory, filename)),
  } = {},
) {
  return rows
    .map((row) => {
      if (!/^\d{3,}_[A-Za-z0-9-]+\.sql$/.test(row.version)) return { ...row };
      let contents;
      try {
        contents = read(row.version);
      } catch (error) {
        if (error.code === "ENOENT") return { ...row };
        throw error;
      }
      const info = migration_checksums(contents);
      return {
        ...row,
        checksum: info.accepted.has(row.checksum)
          ? info.canonical
          : row.checksum,
      };
    })
    .sort((a, b) =>
      a.version < b.version ? -1 : a.version > b.version ? 1 : 0,
    );
}
