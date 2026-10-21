import test from "node:test";
import assert from "node:assert/strict";

// Optional configured-MySQL check. Only connection-local temporary fixture rows
// are written; no real minibrot row receives fabricated geometry.
test(
  "migrated MySQL supports ray cache reads, saves and lazy retrieval",
  { skip: process.env.FRACTO_DB_INTEGRATION !== "1" },
  async () => {
    const { db_connect } =
      await import("../servers/fracto-data-server/mysql.js");
    const { create_minibrot_ray_handlers } =
      await import("../servers/fracto-data-server/handlers/minibrot_ray_paths.js");
    const { RAY_CACHE_VERSION } =
      await import("../sdk/orbitals/FractoMinibrotRayCache.js");
    const connection = db_connect(),
      db = connection.promise();
    const response = () => ({
      statusCode: 200,
      status(n) {
        this.statusCode = n;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    });
    try {
      const [columns] = await db.query(
        "SHOW COLUMNS FROM free_bailiwicks LIKE 'ray_paths'",
      );
      assert.equal(columns.length, 1);
      assert.equal(columns[0].Null, "YES");
      await db.query(
        "CREATE TEMPORARY TABLE free_bailiwicks (id INT PRIMARY KEY, core_point VARCHAR(256), pattern INT, ray_paths JSON NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)",
      );
      await db.query(
        "INSERT INTO free_bailiwicks (id,core_point,pattern,updated_at) VALUES (7,?,2,'2020-01-01 00:00:00')",
        [JSON.stringify({ x: -1, y: 0 })],
      );
      const handlers = create_minibrot_ray_handlers({
        connect: () => connection,
        disconnect: () => {},
      });
      const result = {
        status: "complete",
        root: { x: -1.25, y: 0 },
        rays: ["2/5", "3/5"].map((key) => ({
          angle: { key, numerator: key[0], denominator: "5" },
          points: [
            { x: -2, y: 0 },
            { x: -1.25, y: 0 },
          ],
          landed: true,
          endpoint_error: 0.001,
        })),
      };
      const request = {
        params: { id: "7" },
        body: {
          version: RAY_CACHE_VERSION,
          core_point: { x: -1, y: 0 },
          period: 2,
          tolerance: 0.002,
          group: "doubling",
          result,
        },
      };
      const put = response();
      await handlers.put(request, put);
      assert.equal(put.statusCode, 200);
      assert.equal(put.body.result.saved, true);
      const get = response();
      await handlers.get(request, get);
      assert.equal(get.body.result.groups.doubling.result.rays.length, 2);
      const [[stamp]] = await db.query(
        "SELECT DATE_FORMAT(updated_at,'%Y-%m-%d') AS stamp FROM free_bailiwicks WHERE id=7",
      );
      assert.equal(stamp.stamp, "2020-01-01");
      result.rays.forEach((ray) => {
        ray.points = Array.from({ length: 40000 }, () => ({ x: -1.25, y: 0 }));
      });
      request.body.tolerance = 0.001;
      const large = response();
      await handlers.put(request, large);
      assert.equal(large.statusCode, 200);
      const [[stored]] = await db.query(
        "SELECT ray_paths FROM free_bailiwicks WHERE id = 7",
      );
      const envelope =
        typeof stored.ray_paths === "string"
          ? JSON.parse(stored.ray_paths)
          : stored.ray_paths;
      assert.equal(envelope.encoding, "gzip-base64");
      const expanded = response();
      await handlers.get(request, expanded);
      assert.equal(
        expanded.body.result.groups.doubling.result.rays[0].points.length,
        40000,
      );
    } finally {
      await db.end();
    }
  },
);
