import test from "node:test";
import assert from "node:assert/strict";
import { MeshInventory } from "../sdk/terrain/Inventory.js";
import { terrain_namespace } from "../sdk/terrain/Cache.js";
import FractoUtil from "../sdk/FractoUtil.js";

const identity = { source_mode: "local", source_generation: "inventory-test" };
const namespace = terrain_namespace(identity);
const entry = (short_code, updates = {}) => ({
  short_code,
  namespace,
  compressed_bytes: 100,
  sha256: "a".repeat(64),
  ...updates,
});

test("inventory generation survives snapshot reload and migrates legacy snapshots", () => {
  const index = new MeshInventory(identity);
  index.upsert(entry("00"));
  const snapshot = index.snapshot();
  assert.equal(MeshInventory.restore(identity, snapshot).epoch, index.epoch);
  const legacy = { ...snapshot };
  delete legacy.epoch;
  assert.notEqual(MeshInventory.restore(identity, legacy).epoch, index.epoch);
  assert.throws(() =>
    MeshInventory.restore(identity, { ...snapshot, epoch: "invalid" }),
  );
});

test("exact mesh membership does not imply parent, child, or numerical tile availability", () => {
  const index = new MeshInventory(identity);
  assert.equal(index.revision, 0);
  assert.equal(index.upsert(entry("0123")), true);
  assert.equal(index.has("0123"), true);
  assert.equal(index.has_ready("0123"), true);
  for (const code of ["01", "012", "01230", "1111"]) {
    assert.equal(index.has(code), false);
    assert.equal(index.has_ready(code), false);
    assert.equal(index.get(code), null);
  }
  const mesh = index.get("0123");
  assert.equal(mesh.level, 4);
  assert.deepEqual(mesh.bounds, FractoUtil.bounds_from_short_code("0123"));
  assert.equal(mesh.status, "ready");
  assert.equal(mesh.sha256, "a".repeat(64));
  assert.equal(mesh.compressed_bytes, 100);
  mesh.bounds.left = 99;
  mesh.namespace = "changed";
  assert.deepEqual(
    index.get("0123").bounds,
    FractoUtil.bounds_from_short_code("0123"),
  );
  assert.equal(index.upsert(entry("0123")), false);
  assert.equal(index.revision, 1);
});

test("availability is filtered by source/profile identity and validation status", () => {
  const index = new MeshInventory(identity);
  index.upsert(entry("00"));
  index.upsert(
    entry("01", { namespace: terrain_namespace({ source_generation: "old" }) }),
  );
  index.upsert(
    entry("02", {
      status: "invalid",
      namespace: null,
      sha256: null,
      compressed_bytes: 0,
    }),
  );
  index.upsert(entry("000", { compressed_bytes: 200 }));
  assert.equal(index.get("01").status, "stale");
  assert.equal(index.has("01"), true);
  assert.equal(index.has_ready("01"), false);
  assert.equal(index.get("02").status, "invalid");
  assert.equal(index.has_ready("02"), false);
  const summary = index.summary();
  assert.deepEqual(
    {
      total: summary.total,
      ready: summary.ready,
      stale: summary.stale,
      invalid: summary.invalid,
      compressed_bytes: summary.compressed_bytes,
    },
    { total: 4, ready: 2, stale: 1, invalid: 1, compressed_bytes: 400 },
  );
  assert.deepEqual(
    summary.levels.map((row) => [row.level, row.total, row.ready]),
    [
      [2, 3, 1],
      [3, 1, 1],
    ],
  );
  index.upsert(entry("01"));
  assert.equal(index.has_ready("01"), true);
  assert.equal(index.summary().stale, 0);
  summary.levels[0].total = 99;
  assert.equal(index.summary().levels[0].total, 3);
});

test("spatial lookup handles mirroring, aspect ratio, boundaries, and independent levels", () => {
  const index = new MeshInventory(identity);
  ["00", "01", "02", "03", "000", "0".repeat(34)].forEach((code) =>
    index.upsert(entry(code)),
  );
  const codes = (...args) =>
    index.tiles_in_scope(...args).map((tile) => tile.short_code);
  assert.deepEqual(codes(2, { x: -1.5, y: 1.5 }, 0.5), ["00"]);
  assert.deepEqual(codes(2, { x: -1.5, y: -1.5 }, 0.5), ["00"]);
  assert.deepEqual(
    codes(2, { x: -1.5, y: -1.5 }, 0.5, 1, { mirror_y: false }),
    [],
  );
  assert.deepEqual(codes(2, { x: -1.5, y: 1 }, 0.5, 3), ["00", "02"]);
  // Merely touching a neighboring edge is not positive-area coverage.
  assert.deepEqual(codes(2, { x: -1.5, y: 1.5 }, 1), ["00"]);
  assert.deepEqual(codes(2, { x: -1.5, y: 0 }, 0.5, 5), ["00", "02"]);
  assert.deepEqual(codes(3, { x: -1.75, y: 1.75 }, 0.1), ["000"]);
  assert.deepEqual(codes(4, { x: -1.75, y: 1.75 }, 0.1), []);
  const size = 2 ** (2 - 34);
  assert.deepEqual(codes(34, { x: -2 + size / 2, y: 2 - size / 2 }, size / 2), [
    "0".repeat(34),
  ]);
  assert.deepEqual(codes(2, { x: 5, y: 5 }, 1), []);
});

test("updates and removal invalidate spatial caches and advance revision only on changes", () => {
  const index = new MeshInventory(identity),
    view = [2, { x: -1, y: 1 }, 2];
  index.upsert(entry("00"));
  assert.equal(index.tiles_in_scope(...view).length, 1);
  index.upsert(entry("01"));
  assert.equal(index.tiles_in_scope(...view).length, 2);
  index.upsert(entry("00", { status: "invalid" }));
  assert.deepEqual(
    index.tiles_in_scope(...view).map((tile) => tile.short_code),
    ["01"],
  );
  assert.equal(
    index.tiles_in_scope(...view, 1, { include_unavailable: true }).length,
    2,
  );
  assert.equal(index.remove("00"), true);
  assert.equal(index.remove("00"), false);
  assert.equal(index.remove("01"), true);
  assert.equal(index.revision, 5);
  assert.deepEqual(index.tiles_in_scope(...view), []);
  assert.deepEqual(index.summary().levels, []);
});

test("column lookup agrees with a brute-force intersection across mixed statuses and viewports", () => {
  const index = new MeshInventory(identity),
    records = [];
  for (let i = 0; i < 256; i++) {
    const code = i.toString(4).padStart(4, "0");
    index.upsert(
      entry(
        code,
        i % 3 === 0
          ? { status: "invalid" }
          : i % 3 === 1
            ? { namespace: "b".repeat(32) }
            : {},
      ),
    );
    records.push(index.get(code));
  }
  for (let i = 0; i < 40; i++) {
    const x = -2.5 + ((i * 13) % 50) / 10,
      y = -2.5 + ((i * 7) % 50) / 10;
    const scope = 0.13 + i / 30,
      aspect = 0.4 + (i % 4);
    const left = x - scope / 2,
      right = x + scope / 2;
    const bottom = y - (scope * aspect) / 2,
      top = y + (scope * aspect) / 2;
    for (const include_unavailable of [false, true]) {
      const expected = records
        .filter((record) => {
          if (!include_unavailable && record.status !== "ready") return false;
          const b = record.bounds;
          return (
            b.left < right &&
            b.right > left &&
            ((b.bottom < top && b.top > bottom) ||
              (b.bottom >= 0 && -b.top < top && -b.bottom > bottom))
          );
        })
        .map((record) => record.short_code)
        .sort();
      const actual = index
        .tiles_in_scope(4, { x, y }, scope, aspect, { include_unavailable })
        .map((record) => record.short_code)
        .sort();
      assert.deepEqual(
        actual,
        expected,
        `viewport ${i}, unavailable ${include_unavailable}`,
      );
    }
  }
});

test("invalid inventory records and viewports cannot mutate availability", () => {
  assert.throws(() => new MeshInventory());
  const index = new MeshInventory(identity);
  for (const changes of [
    { short_code: "../01" },
    { short_code: "04" },
    { short_code: "0".repeat(35) },
    { compressed_bytes: -1 },
    { compressed_bytes: 0 },
    { compressed_bytes: 0.5 },
    { namespace: null },
    { sha256: null },
    { sha256: "bad" },
    { status: "stale" },
  ])
    assert.throws(() => index.upsert(entry("00", changes)));
  for (const args of [
    [1, { x: 0, y: 0 }, 1],
    [35, { x: 0, y: 0 }, 1],
    [2, { x: null, y: 0 }, 1],
    [2, { x: 0, y: 0 }, 0],
    [2, { x: 0, y: 0 }, 1, -1],
    [2, { x: 0, y: 0 }, Number.MAX_VALUE, Number.MAX_VALUE],
  ])
    assert.throws(() => index.tiles_in_scope(...args));
  assert.equal(index.revision, 0);
  assert.equal(index.summary().total, 0);
});
