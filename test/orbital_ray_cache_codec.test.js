import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { encode_ray_cache } from "../servers/fracto-data-server/handlers/minibrot_ray_codec.js";
import {
  prepare_orbital_cache,
  save_orbital_cache,
  decode_orbital_cache,
} from "../servers/fracto-data-server/handlers/orbital_ray_cache_codec.js";

test("orbital cache retains legacy inline formats", async () => {
  const cache = { geometry: "x".repeat(2 * 1024 * 1024) };
  const prepared = await prepare_orbital_cache(cache);
  assert.equal(prepared.chunks.length, 0);
  assert.deepEqual(await decode_orbital_cache(null, prepared.value), cache);
  assert.deepEqual(await decode_orbital_cache(null, { old: true }), {
    old: true,
  });
});

test("large lossless caches cross the old storage limit with bounded verified SQL chunks", async () => {
  const cache = { geometry: randomBytes(16 * 1024 * 1024).toString("hex") };
  await assert.rejects(encode_ray_cache(cache), /20 MiB stored/);
  const prepared = await prepare_orbital_cache(cache);
  assert.ok(prepared.chunks.length > 1);
  const chunks = new Map();
  const db = {
    execute: async (sql, args) => {
      if (sql.startsWith("INSERT")) {
        assert.ok(args[1].length <= 8 * 1024 * 1024);
        chunks.set(args[0], args[1]);
        return [{ affectedRows: 1 }];
      }
      return [
        [chunks.has(args[0]) ? { payload: chunks.get(args[0]) } : null].filter(
          Boolean,
        ),
      ];
    },
  };
  const manifest = await save_orbital_cache(db, prepared);
  assert.deepEqual(await decode_orbital_cache(db, manifest), cache);
  await save_orbital_cache(db, prepared);
  assert.equal(
    chunks.size,
    prepared.chunks.length,
    "content addressed writes are idempotent",
  );
  const first = prepared.chunks[0];
  chunks.set(first.content_hash, Buffer.from("corrupt"));
  await assert.rejects(
    decode_orbital_cache(db, manifest),
    /invalid_orbital_cache_chunks/,
  );
  chunks.delete(first.content_hash);
  await assert.rejects(
    decode_orbital_cache(db, manifest),
    /invalid_orbital_cache_chunks/,
  );
  await assert.rejects(
    decode_orbital_cache(db, {
      ...JSON.parse(manifest),
      raw_bytes: 100 * 1024 * 1024,
    }),
    /invalid_orbital_cache_chunks/,
  );
});
