import test from "node:test";
import assert from "node:assert/strict";
import { trace_known_dynamic_rays } from "../sdk/orbitals/FractoKnownDynamicRays.js";
import { rational_angle } from "../sdk/orbitals/FractoRayGeometry.js";
import { build_orbital_trace_request } from "../sdk/orbitals/FractoOrbitalTraceRequest.js";
import { SEED_SURVEY_RAY_OPTIONS } from "../sdk/orbitals/FractoDynamicRays.js";
import {
  ORBITAL_RAY_CACHE_VERSION,
  orbital_ray_cache_matches,
  orbital_ray_identity,
  merge_orbital_ray_cache,
  cached_orbital_rays,
} from "../sdk/orbitals/FractoOrbitalRayCache.js";
import { OrbitalRayPathStore } from "../servers/fracto-data-server/handlers/orbital_ray_paths.js";

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
const fixture = trace_known_dynamic_rays(request);
const payload = async () => ({
  version: ORBITAL_RAY_CACHE_VERSION,
  request,
  quality: SEED_SURVEY_RAY_OPTIONS,
  rays: (await fixture).rays,
});

test("persistent Julia geometry has exact identity and invalidates changed coordinates, ratios, and solver", async () => {
  const cache = merge_orbital_ray_cache(null, request, (await fixture).rays);
  assert.equal(
    cached_orbital_rays(JSON.parse(JSON.stringify(cache)), request).length,
    1,
  );
  assert.equal(
    orbital_ray_cache_matches(cache, {
      ...request,
      focal_point: { x: "0.000", y: "0e2" },
    }),
    true,
  );
  const exact = {
    ...request,
    focal_point: { x: "0.12345678901234567890123456789", y: "0" },
  };
  assert.equal(orbital_ray_identity(exact).focal_point.x, exact.focal_point.x);
  for (const changed of [
    { ...request, focal_point: { x: "0.0000000000000000000000001", y: "0" } },
    {
      ...request,
      orbital_points: [{ re: "1.0000000000000000000001", im: "0" }],
    },
    {
      ...request,
      requests: [
        { ...request.requests[0], angle: { numerator: "1", denominator: "3" } },
      ],
    },
  ])
    assert.equal(orbital_ray_cache_matches(cache, changed), false);
  assert.equal(
    cached_orbital_rays({ ...cache, version: "old" }, request).length,
    0,
  );
});

test("weaker, failed, malformed, and wrong-target paths cannot replace validated cache entries", async () => {
  const rays = (await fixture).rays;
  const good = merge_orbital_ray_cache(null, request, rays);
  const weaker = merge_orbital_ray_cache(good, request, rays, {
    ...SEED_SURVEY_RAY_OPTIONS,
    tolerance: 1e-5,
  });
  assert.deepEqual(weaker.entries["0/1"], good.entries["0/1"]);
  assert.equal(
    cached_orbital_rays(good, request, {
      ...SEED_SURVEY_RAY_OPTIONS,
      tolerance: 1e-8,
    }).length,
    0,
  );
  assert.throws(
    () => merge_orbital_ray_cache(good, request, []),
    /invalid_ray_paths/,
  );
  assert.throws(
    () =>
      merge_orbital_ray_cache(good, request, [
        { ...rays[0], reason: "point_limit" },
      ]),
    /invalid_ray_paths/,
  );
  assert.throws(
    () =>
      merge_orbital_ray_cache(good, request, [
        { ...rays[0], endpoint: { x: 4, y: 0 } },
      ]),
    /invalid_ray_paths/,
  );
  assert.equal(cached_orbital_rays(good, request).length, 1);
});

test("cache eligibility keeps good families while refining an insufficiently accurate family as a unit", () => {
  // Two accesses to each point of the analytic z²-2 period-three orbit.
  const points = [1, 2, 4].map((n) => ({
    re: String(2 * Math.cos((2 * Math.PI * n) / 7)),
    im: "0",
  }));
  const request = build_orbital_trace_request(
    { x: "-2", y: "0" },
    {
      orbital_id: "43",
      period: 3,
      points: points.map((point, point_index) => ({
        point_index,
        point,
        landing_ratios: [1, -1].map((sign) => ({
          numerator: String((sign * [1, 2, 4][point_index] + 7) % 7),
          denominator: "7",
        })),
      })),
    },
  );
  const geometry = (numerators) =>
    numerators.map((n, point_index) => {
      const endpoint = { x: Number(points[point_index].re), y: 0 };
      return {
        angle: rational_angle(n, 7),
        point_index,
        endpoint,
        points: [{ x: endpoint.x * 2, y: 0 }, endpoint],
        reason: "potential_limit",
        precision_error: 0,
        landing_error: 0,
      };
    });
  const fine = merge_orbital_ray_cache(null, request, geometry([1, 2, 4]));
  const partial = merge_orbital_ray_cache(fine, request, geometry([6, 5, 3]), {
    ...SEED_SURVEY_RAY_OPTIONS,
    tolerance: 1e-5,
  });
  assert.deepEqual(
    cached_orbital_rays(partial, request)
      .map((r) => r.angle.key)
      .sort(),
    ["1/7", "2/7", "4/7"],
  );
  partial.entries["6/7"].quality = { ...SEED_SURVEY_RAY_OPTIONS };
  const reusable = cached_orbital_rays(partial, request);
  assert.equal(
    reusable.length,
    3,
    "one refined partner is not a complete reusable family",
  );
  const saved = new Set(reusable.map((r) => r.angle.key));
  assert.deepEqual(
    request.requests
      .filter((r) => !saved.has(r.angle.key))
      .map((r) => r.angle.key)
      .sort(),
    ["3/7", "5/7", "6/7"],
  );
});

const response = () => ({
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});
function database() {
  let paths = null,
    current = orbital,
    gate = Promise.resolve();
  const events = [];
  const store = new OrbitalRayPathStore({
    store: { get: async () => current },
    connect: () => {
      let release;
      return {
        promise: () => ({
          async beginTransaction() {
            const before = gate;
            gate = new Promise((r) => {
              release = r;
            });
            await before;
            events.push("begin");
          },
          async execute(sql, values) {
            events.push(sql);
            if (sql.startsWith("SELECT id")) return [[{ id: "42" }]];
            if (sql.startsWith("SELECT paths"))
              return [paths ? [{ paths }] : []];
            paths = values[1];
            return [{ affectedRows: 1 }];
          },
          async commit() {
            events.push("commit");
            release();
          },
          async rollback() {
            events.push("rollback");
            release();
          },
        }),
      };
    },
    disconnect: () => events.push("disconnect"),
  });
  return {
    store,
    events,
    change: (value) => {
      current = value;
    },
  };
}

test("storage persists and reloads paths, serializes concurrent merges, and fences stale writes", async () => {
  const db = database(),
    body = await payload();
  assert.equal(await db.store.get("42"), null);
  await Promise.all([db.store.put("42", body), db.store.put("42", body)]);
  const loaded = await db.store.get("42");
  assert.equal(cached_orbital_rays(loaded, request).length, 1);
  assert.equal(db.events.filter((e) => e === "commit").length, 2);
  assert.ok(db.events.some((e) => e.includes("FOR UPDATE")));
  db.change({ ...orbital, focal_point: { re: "0.1", im: "0" } });
  await assert.rejects(db.store.put("42", body), (e) => e.status === 409);
  assert.equal(await db.store.get("42"), null);
  assert.ok(db.events.includes("rollback"));
});

test("cache routes use the existing origin boundary and reject malformed writes before connecting", async () => {
  const db = database();
  await assert.rejects(
    db.store.put("42", { ...(await payload()), version: "old" }),
    (e) => e.status === 400,
  );
  assert.equal(db.events.length, 0);
  const { default: express } = await import("express");
  const { create_orbital_data_router } =
    await import("../servers/fracto-data-server/handlers/orbital_data_routes.js");
  const app = express();
  app.use(express.json({ limit: "25mb" }));
  app.use(
    "/orbital-data",
    create_orbital_data_router({ jobs: { store: {} }, ray_paths: db.store }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/orbital-data/42/ray-paths`;
    assert.equal((await fetch(url)).status, 200);
    const bad = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://untrusted.invalid",
      },
      body: JSON.stringify(await payload()),
    });
    assert.equal(bad.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
