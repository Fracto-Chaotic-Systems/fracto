import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { plan_mesh_transform } from "../sdk/terrain/TransformPlan.js";
import { cache_terrain_plan } from "../sdk/terrain/Cache.js";
import { create_terrain_cache_handlers } from "../servers/fracto-tiles-server/terrain/Jobs.js";
import {
  lifecycle_fixture,
  reopen_inventory,
  source,
} from "./mesh_lifecycle_helpers.js";

const selection = {
  count: 1,
  level: 2,
  region: { focal_point: { x: -1.5, y: 1.5 }, scope: 1, aspect_ratio: 1 },
};
const level_data = {
  tile_size: 1,
  columns: [{ left: -2, tiles: [{ short_code: "00", bottom: 1 }] }],
};
const response = () => ({
  code: 200,
  status(code) {
    this.code = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});
const tick = () => new Promise(setImmediate);

test("region transforms select the clicked level, skip ready meshes and mirror canonical files once", () => {
  const data = {
    columns: [
      {
        left: -2,
        tiles: [
          { short_code: "00", bottom: 1 },
          { short_code: "02", bottom: 0 },
        ],
      },
      { left: -1, tiles: [{ short_code: "01", bottom: 1 }] },
    ],
  };
  const index = { has_ready: (code) => code === "01" };
  for (const y of [1, -1, 0]) {
    const input = {
      count: 2,
      level: 2,
      region: {
        focal_point: { x: -1, y },
        scope: 2,
        aspect_ratio: y === 0 ? 2 : 1,
      },
    };
    const plan = plan_mesh_transform(input, data, index);
    assert.deepEqual(
      plan.tiles.map((tile) => tile.short_code),
      ["00", "02"],
    );
    assert.equal(plan.kind, "region");
    assert.equal(plan.bailiwick_id, undefined);
    assert.equal(plan.tiles[0].instances.length, y === 0 ? 2 : 1);
    assert.equal(plan.tiles[0].instances[0].mirror_y, y < 0);
  }
  assert.throws(
    () =>
      plan_mesh_transform({ ...selection, count: 2 }, level_data, {
        has_ready: () => false,
      }),
    { status: 409 },
  );
  assert.throws(() =>
    plan_mesh_transform({ ...selection, level: 35 }, level_data, index),
  );
  assert.throws(() =>
    plan_mesh_transform({ ...selection, count: 200001 }, level_data, index),
  );
});

test("region construction writes a region manifest and publishes ready inventory without a bailiwick", async () =>
  lifecycle_fixture("level", async ({ options }) => {
    const store = await reopen_inventory(options);
    const plan = plan_mesh_transform(selection, level_data, store.inventory);
    const result = await cache_terrain_plan({
      plan,
      cache_root: options.root,
      mesh_layout: options.layout,
      source_identity: options.source_identity,
      read_tile: async () => source,
      before_write: (code) => store.begin(code),
      after_tile: (code) => store.observe(code, { complete: true }),
    });
    assert.equal(result.created, 1);
    assert.equal(store.inventory.has_ready("00"), true);
    assert.match(result.manifest, /region-level-2-/);
    const manifest = JSON.parse(
      await fs.readFile(path.join(options.root, result.manifest), "utf8"),
    );
    assert.equal(manifest.coverage_kind, "pending-indexed");
    assert.throws(
      () => plan_mesh_transform(selection, level_data, store.inventory),
      { status: 409 },
    );
  }));

test("region jobs share the queue, stop safely, retain progress and reject stale selections", async () => {
  const saved = new Set(),
    workers = [],
    order = [];
  const handlers = create_terrain_cache_handlers({
    source_identity: {},
    get_level: () => level_data,
    inventory_store: {
      inventory: { has_ready: (code) => saved.has(code) },
      recover_pending: async () => {
        order.push("recover");
        saved.add("00");
      },
    },
    create_worker: () => {
      const worker = new EventEmitter();
      worker.terminate = async () => order.push("terminate");
      workers.push(worker);
      return worker;
    },
  });
  const first = response();
  handlers.start_region({ body: selection }, first);
  assert.equal(first.code, 202);
  const duplicate = response();
  handlers.start_region({ body: selection }, duplicate);
  assert.equal(duplicate.body.job.id, first.body.job.id);
  assert.equal(workers.length, 1);
  workers[0].emit("message", {
    progress: {
      processed: 1,
      created: 1,
      reused: 0,
      failed: 0,
      short_code: "00",
      mesh_ready: true,
    },
  });
  const preview = response();
  handlers.status({ params: { id: first.body.job.id } }, preview);
  assert.equal(preview.body.job.preview_short_code, "00");
  workers[0].emit("message", {
    progress: {
      processed: 2,
      created: 1,
      reused: 0,
      failed: 1,
      short_code: "01",
      mesh_ready: false,
    },
  });
  handlers.status({ params: { id: first.body.job.id } }, preview);
  assert.equal(
    preview.body.job.preview_short_code,
    "00",
    "failed tiles must not replace the published preview",
  );
  const stopped = response();
  await handlers.cancel({ params: { id: first.body.job.id } }, stopped);
  assert.deepEqual(order, ["terminate", "recover"]);
  assert.equal(stopped.body.job.status, "cancelled");
  assert.equal(stopped.body.job.total, 1);
  assert.equal(stopped.body.job.created, 1);
  assert.equal(stopped.body.job.processed, 2);
  const stale = response();
  handlers.start_region({ body: selection }, stale);
  assert.equal(stale.code, 409);
  const absent = response();
  await handlers.cancel({ params: { id: "missing" } }, absent);
  assert.equal(absent.code, 404);
  await tick();
});

test("a full mesh volume aborts construction at the first tile", async () =>
  lifecycle_fixture("level", async ({ options }) => {
    const store = await reopen_inventory(options);
    const plan = plan_mesh_transform(selection, level_data, store.inventory);
    const before = process.env.FRACTO_TILE_MIN_FREE_BYTES;
    let reads = 0;
    process.env.FRACTO_TILE_MIN_FREE_BYTES = String(Number.MAX_SAFE_INTEGER);
    try {
      await assert.rejects(
        cache_terrain_plan({
          plan,
          cache_root: options.root,
          mesh_layout: options.layout,
          source_identity: options.source_identity,
          read_tile: async () => {
            reads++;
            return source;
          },
        }),
        { code: "MESH_CAPACITY" },
      );
    } finally {
      if (before === undefined) delete process.env.FRACTO_TILE_MIN_FREE_BYTES;
      else process.env.FRACTO_TILE_MIN_FREE_BYTES = before;
    }
    assert.equal(reads, 1);
    assert.equal(store.inventory.has("00"), false);
  }));

test("one-pass workers can release decoded source tiles without deleting stored data", async () =>
  lifecycle_fixture("level", async ({ directory }) => {
    const root = path.join(directory, "source");
    await fs.mkdir(path.join(root, "L02"), { recursive: true });
    const file = path.join(root, "L02", "00.gz");
    await fs.writeFile(file, gzipSync(JSON.stringify(source)));
    const module = new URL("../sdk/FractoTileCache.js", import.meta.url).href;
    const script = `import assert from 'node:assert/strict';import Cache from ${JSON.stringify(module)};
    await Cache.get_tile('00');assert.equal(Cache.get_stats().in_memory,1);
    assert.equal(Cache.release_tile('00'),true);assert.equal(Cache.get_stats().in_memory,0);
    assert.equal(Cache.release_tile('00'),false);await Cache.get_tile('00');assert.equal(Cache.get_stats().in_memory,1);`;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          FRACTO_TILE_SOURCE_MODE: "local",
          FRACTO_TILE_SOURCE_DIR: root,
          FRACTO_TILE_SOURCE_GENERATION: "worker-test",
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.ok((await fs.stat(file)).size > 0);
  }));
