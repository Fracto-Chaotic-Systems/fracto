import test from "node:test";
import assert from "node:assert/strict";

test(
  "MySQL round trip preserves validated Julia geometry without writing real orbital rows",
  {
    skip: process.env.FRACTO_DB_INTEGRATION !== "1",
  },
  async () => {
    const { db_connect, db_disconnect } =
      await import("../servers/fracto-data-server/mysql.js");
    const { OrbitalRayPathStore } =
      await import("../servers/fracto-data-server/handlers/orbital_ray_paths.js");
    const { build_orbital_trace_request } =
      await import("../sdk/orbitals/FractoOrbitalTraceRequest.js");
    const { trace_known_dynamic_rays } =
      await import("../sdk/orbitals/FractoKnownDynamicRays.js");
    const { ORBITAL_RAY_CACHE_VERSION, cached_orbital_rays } =
      await import("../sdk/orbitals/FractoOrbitalRayCache.js");
    const { SEED_SURVEY_RAY_OPTIONS } =
      await import("../sdk/orbitals/FractoDynamicRays.js");
    const connection = db_connect(),
      db = connection.promise();
    try {
      const [columns] = await db.query("SHOW COLUMNS FROM orbital_ray_paths");
      assert.ok(columns.some((c) => c.Field === "paths" && c.Type === "json"));
      await db.query(
        "CREATE TEMPORARY TABLE orbital_progressions (id BIGINT UNSIGNED PRIMARY KEY)",
      );
      await db.query(
        "CREATE TEMPORARY TABLE orbital_ray_paths (orbital_id BIGINT UNSIGNED PRIMARY KEY, paths JSON NOT NULL)",
      );
      await db.query("INSERT INTO orbital_progressions (id) VALUES (42)");
      const orbital = {
        orbital_id: "42",
        period: 1,
        focal_point: { re: "0", im: "0" },
        points: [
          {
            point_index: 0,
            point: { re: "1", im: "0" },
            landing_ratios: [{ numerator: "0", denominator: "1" }],
          },
        ],
      };
      const request = build_orbital_trace_request({ x: "0", y: "0" }, orbital);
      const rays = (await trace_known_dynamic_rays(request)).rays;
      const store = new OrbitalRayPathStore({
        connect: () => connection,
        disconnect: () => {},
        store: { get: async () => orbital },
      });
      assert.equal(await store.get("42"), null);
      await store.put("42", {
        version: ORBITAL_RAY_CACHE_VERSION,
        request,
        rays,
        quality: SEED_SURVEY_RAY_OPTIONS,
      });
      assert.equal(
        cached_orbital_rays(await store.get("42"), request).length,
        1,
      );
    } finally {
      db_disconnect(connection);
    }
  },
);
