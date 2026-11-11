import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

test(
  "a selected 162-ray catalog family persists beyond the former upload limit and reloads without tracing",
  {
    skip: process.env.FRACTO_DB_INTEGRATION !== "1",
  },
  async (t) => {
    const { open_orbital_database } =
      await import("../servers/fracto-data-server/handlers/orbital_data_database.js");
    const { OrbitalRayPathStore } =
      await import("../servers/fracto-data-server/handlers/orbital_ray_paths.js");
    const { build_denominator_catalog, catalog_doubling_families } =
      await import("../sdk/orbitals/FractoDenominatorCatalog.js");
    const { discover_validated_representative_orbital } =
      await import("../sdk/orbitals/FractoLandingAssignments.js");
    const { build_orbital_trace_request } =
      await import("../sdk/orbitals/FractoOrbitalTraceRequest.js");
    const { trace_known_dynamic_rays } =
      await import("../sdk/orbitals/FractoKnownDynamicRays.js");
    const { ORBITAL_RAY_CACHE_VERSION, cached_orbital_rays } =
      await import("../sdk/orbitals/FractoOrbitalRayCache.js");
    const { SEED_SURVEY_RAY_OPTIONS } =
      await import("../sdk/orbitals/FractoDynamicRays.js");
    const db = await open_orbital_database();
    try {
      // Connection-local tables shadow application tables and vanish on disconnect.
      await db.query(
        "CREATE TEMPORARY TABLE orbital_progressions (id BIGINT UNSIGNED PRIMARY KEY,lifecycle_state JSON NULL)",
      );
      await db.query(
        "CREATE TEMPORARY TABLE orbital_ray_paths (orbital_id BIGINT UNSIGNED PRIMARY KEY,paths JSON NOT NULL)",
      );
      await db.query(
        "CREATE TEMPORARY TABLE orbital_ray_cache_chunks (content_hash CHAR(64) PRIMARY KEY,payload MEDIUMBLOB NOT NULL)",
      );
      await db.query("INSERT INTO orbital_progressions (id) VALUES (163)");
      const family = [
        ...catalog_doubling_families(
          build_denominator_catalog({ max_denominator: 163 }),
        ),
      ].find((f) => f.key === "1/163");
      const compact = discover_validated_representative_orbital(
        { x: "0", y: "0" },
        family,
      );
      assert.equal(compact.status, "assignments_verified", compact.reason);
      const orbital = {
        orbital_id: "163",
        period: compact.candidate.period,
        focal_point: { re: "0", im: "0" },
        ray_status: "rays_found",
        points: compact.candidate.points.map((point, point_index) => ({
          point,
          point_index,
          landing_ratios: compact.landing_ratios.filter(
            (r) => r.point_index === point_index,
          ),
        })),
      };
      const request = build_orbital_trace_request({ x: "0", y: "0" }, orbital);
      const create = () =>
        new OrbitalRayPathStore({
          connect: () => ({ promise: () => db }),
          disconnect: () => {},
          store: { get: async () => orbital },
        });
      const store = create();
      assert.equal(await store.get("163"), null);
      const trace_start = performance.now();
      const result = await trace_known_dynamic_rays(request);
      const trace_ms = performance.now() - trace_start;
      assert.equal(
        result.status,
        "rays_found",
        JSON.stringify(result.unresolved),
      );
      const payload = {
        version: ORBITAL_RAY_CACHE_VERSION,
        request,
        rays: result.rays,
        quality: SEED_SURVEY_RAY_OPTIONS,
      };
      const bytes = Buffer.byteLength(JSON.stringify(payload));
      t.diagnostic(`selected path upload: ${bytes} bytes`);
      assert.ok(bytes > 20 * 1024 * 1024, "exercise the former upload blocker");
      const save_start = performance.now();
      await store.put("163", payload);
      const save_ms = performance.now() - save_start;
      const load_start = performance.now();
      const restored = await create().get("163");
      assert.equal(cached_orbital_rays(restored, request).length, 162);
      const persistent_load_ms = performance.now() - load_start;
      const [rows] = await db.query(
        "SELECT lifecycle_state FROM orbital_progressions WHERE id=163",
      );
      const state =
        typeof rows[0].lifecycle_state === "string"
          ? JSON.parse(rows[0].lifecycle_state)
          : rows[0].lifecycle_state;
      assert.equal(state.paths.status, "cached");
      assert.equal(state.paths.cached_rays, 162);
      if (process.env.FRACTO_RAY_BENCHMARK_OUTPUT) {
        const output = resolve(process.env.FRACTO_RAY_BENCHMARK_OUTPUT);
        const report = {
          measured_at: new Date().toISOString(),
          node: process.version,
          family: "1/163",
          parameter: { x: "0", y: "0" },
          period: 162,
          rays: 162,
          payload_bytes: bytes,
          trace_ms,
          save_ms,
          persistent_load_ms,
          quality: SEED_SURVEY_RAY_OPTIONS,
          verified: true,
          application_rows_changed: false,
          limitations:
            "Single development-machine observation. Load includes SQL, decompression and geometry validation; browser transfer and painting are excluded. Tables are connection-local and disappear on disconnect.",
        };
        await mkdir(dirname(output), { recursive: true });
        await writeFile(output, JSON.stringify(report, null, 2) + "\n");
        t.diagnostic(JSON.stringify(report));
      }
    } finally {
      await db.end();
    }
  },
);
