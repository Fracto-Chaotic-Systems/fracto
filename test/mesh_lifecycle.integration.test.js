import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { cache_terrain_plan } from "../sdk/terrain/Cache.js";
import {
  identity,
  source,
  lifecycle_fixture,
  serve_inventory,
  map_result,
  crash_owner,
  reopen_inventory,
} from "./mesh_lifecycle_helpers.js";

for (const layout of ["level", "shortcode"]) {
  test(`${layout}: build, reuse, retrieval repair, reconciliation and source changes reach the heat map`, async () =>
    lifecycle_fixture(layout, async ({ options, filename, write }) => {
      const store = await reopen_inventory(options);
      await serve_inventory(store, options, async (request) => {
        assert.equal((await map_result(request)).uncovered_pixel_count, 256);
        let source_reads = 0;
        const build = () =>
          cache_terrain_plan({
            plan: {
              bailiwick_id: 55,
              level: 2,
              region: { scope: 1 },
              tiles: [{ short_code: "00" }],
              missing_tiles: [],
            },
            cache_root: options.root,
            mesh_layout: layout,
            source_identity: identity,
            read_tile: async () => {
              source_reads++;
              return source;
            },
            before_write: (code) => store.begin(code),
            after_tile: (code) => store.observe(code, { complete: true }),
          });
        assert.equal((await build()).created, 1);
        const ready = await map_result(request);
        assert.equal(ready.coverage[0].mesh_count, 1);
        assert.equal(ready.uncovered_pixel_count, 0);
        assert.equal(
          (await map_result(request, { focal_point_y: -1.5 }))
            .uncovered_pixel_count,
          0,
        );
        const revision = ready.inventory_revision;
        assert.equal((await build()).reused, 1);
        assert.equal(source_reads, 1);
        assert.equal((await map_result(request)).inventory_revision, revision);
        // Heat-map requests must not scan or read any file after publication.
        const read = fs.readFile,
          scan = fs.readdir;
        fs.readFile = fs.readdir = async () => {
          throw new Error("Heat-map filesystem access");
        };
        try {
          assert.equal((await map_result(request)).uncovered_pixel_count, 0);
        } finally {
          fs.readFile = read;
          fs.readdir = scan;
        }
        await fs.writeFile(filename("00"), "corrupt");
        assert.equal((await request("/meshes/00")).status, 503);
        const invalid = await map_result(request);
        assert.ok(invalid.inventory_revision > revision);
        assert.equal(invalid.uncovered_pixel_count, 256);
        assert.equal((await build()).created, 1);
        assert.equal((await map_result(request)).uncovered_pixel_count, 0);
        await fs.unlink(filename("00"));
        assert.equal((await request("/meshes/00")).status, 404);
        assert.equal((await map_result(request)).uncovered_pixel_count, 256);
        await write("00");
        assert.equal((await map_result(request)).uncovered_pixel_count, 256); // external addition needs reconciliation
        const reconciled = await request("/mesh_inventory/reconcile", {
          method: "POST",
        });
        assert.equal(reconciled.status, 200);
        assert.equal((await map_result(request)).uncovered_pixel_count, 0);
      });
      const reopened = await reopen_inventory(options);
      assert.deepEqual(reopened.inventory.summary(), store.inventory.summary());
      const changed_options = {
        ...options,
        source_identity: { generation: "next-source" },
      };
      const changed = await reopen_inventory(changed_options);
      await serve_inventory(changed, changed_options, async (request) => {
        const summary = await (await request("/mesh_inventory")).json();
        assert.equal(summary.stale, 1);
        assert.equal((await request("/meshes/00")).status, 409);
        assert.equal((await map_result(request)).uncovered_pixel_count, 256);
      });
    }));

  test(`${layout}: destructive index recovery changes the refresh token even when revision and source repeat`, async () =>
    lifecycle_fixture(layout, async ({ options, filename, write }) => {
      await write("00");
      const first = await reopen_inventory(options);
      const before = first.inventory.summary();
      await fs.unlink(filename("00"));
      await write("01");
      await fs.writeFile(
        path.join(options.root, "inventory.json"),
        "damaged snapshot",
      );
      const restored = await reopen_inventory(options);
      const after = restored.inventory.summary();
      assert.equal(after.revision, before.revision);
      assert.equal(after.namespace, before.namespace);
      assert.notEqual(after.inventory_epoch, before.inventory_epoch);
      await serve_inventory(restored, options, async (request) => {
        const map = await map_result(request);
        assert.equal(map.uncovered_pixel_count, 256);
        assert.equal(map.inventory_epoch, after.inventory_epoch);
      });
    }));

  test(`${layout}: actual process loss before and after file publication recovers without phantom coverage`, async () =>
    lifecycle_fixture(
      layout,
      async ({ directory, options, filename, write }) => {
        await reopen_inventory(options);
        await crash_owner(options, { code: "01", publish: false });
        const absent = await reopen_inventory(options);
        assert.equal(absent.inventory.has("01"), false);
        assert.equal(absent.journal.pending.size, 0);
        await write("00");
        const fixture_file = path.join(directory, "published-fixture.gz");
        await fs.rename(filename("00"), fixture_file);
        await crash_owner(options, { code: "00", publish: true, fixture_file });
        const recovered = await reopen_inventory(options);
        assert.equal(recovered.inventory.has_ready("00"), true);
        assert.equal(recovered.journal.pending.size, 0);
        await serve_inventory(recovered, options, async (request) => {
          assert.equal((await map_result(request)).uncovered_pixel_count, 0);
          assert.equal((await request("/meshes/00")).status, 200);
        });
      },
    ));
}
