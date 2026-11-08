import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { build_orbital_trace_request } from "../sdk/orbitals/FractoOrbitalTraceRequest.js";
import { trace_known_dynamic_rays } from "../sdk/orbitals/FractoKnownDynamicRays.js";
import {
  merge_orbital_ray_cache,
  cached_orbital_rays,
  ORBITAL_RAY_CACHE_VERSION,
} from "../sdk/orbitals/FractoOrbitalRayCache.js";
import { SEED_SURVEY_RAY_OPTIONS } from "../sdk/orbitals/FractoDynamicRays.js";
import { sqrt, sub, scale } from "../sdk/orbitals/FractoRayGeometry.js";
import {
  encode_ray_cache,
  decode_ray_cache,
} from "../servers/fracto-data-server/handlers/minibrot_ray_codec.js";

const args = process.argv.slice(2);
const flag = (name, fallback) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const runs = Number(flag("--runs", "3"));
if (!Number.isInteger(runs) || runs < 1 || runs > 10)
  throw Error("--runs must be between 1 and 10");
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.resolve(
  root,
  flag("--out", "benchmarks/known-orbital-rays-latest.json"),
);
const database = args.includes("--database");
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b),
    mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const measure = async (operation) => {
  const start = performance.now();
  const value = await operation();
  return { value, ms: performance.now() - start };
};
const repeated = async (count, operation) => {
  const times = [];
  for (let i = 0; i < count; i++) times.push((await measure(operation)).ms);
  return {
    median_ms: median(times),
    min_ms: Math.min(...times),
    max_ms: Math.max(...times),
    samples: times,
  };
};
const make = (id, name, c, points, ratios) => {
  const orbital = {
    orbital_id: String(id),
    period: points.length,
    focal_point: { re: String(c.x), im: String(c.y) },
    points: points.map((p, point_index) => ({
      point_index,
      point: { re: String(p.x), im: String(p.y) },
      landing_ratios: ratios[point_index].map(([numerator, denominator]) => ({
        numerator: String(numerator),
        denominator: String(denominator),
      })),
    })),
  };
  return { name, orbital, request: build_orbital_trace_request(c, orbital) };
};
const cycle = (period, start) => {
  const denominator = 2 ** period - 1,
    values = [];
  let n = start;
  do {
    values.push(n);
    n = (2 * n) % denominator;
  } while (n !== start);
  return {
    points: values.map((v) => ({
      x: Math.cos((2 * Math.PI * v) / denominator),
      y: Math.sin((2 * Math.PI * v) / denominator),
    })),
    ratios: values.map((v) => [[v, denominator]]),
  };
};
const rabbit_c = { x: -0.1225611668766536, y: 0.7448617666197442 };
const rabbit_point = scale(
  sub({ x: 1, y: 0 }, sqrt({ x: 1 - 4 * rabbit_c.x, y: -4 * rabbit_c.y })),
  0.5,
);
const two = cycle(2, 1),
  seven = cycle(7, 5);
const fixtures = [
  make(
    1,
    "Unit circle, fixed point",
    { x: 0, y: 0 },
    [{ x: 1, y: 0 }],
    [[[0, 1]]],
  ),
  make(2, "Unit circle, period 2", { x: 0, y: 0 }, two.points, two.ratios),
  make(3, "Unit circle, period 7", { x: 0, y: 0 }, seven.points, seven.ratios),
  make(
    4,
    "Rabbit, 3 accesses",
    rabbit_c,
    [rabbit_point],
    [
      [
        [1, 7],
        [2, 7],
        [4, 7],
      ],
    ],
  ),
  make(
    5,
    "Basilica, 2 accesses",
    { x: -1, y: 0 },
    [{ x: (1 - Math.sqrt(5)) / 2, y: 0 }],
    [
      [
        [1, 3],
        [2, 3],
      ],
    ],
  ),
];
const report = {
  generated_at: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    cpu: os.cpus()[0]?.model,
  },
  runs,
  cache_version: ORBITAL_RAY_CACHE_VERSION,
  profile: SEED_SURVEY_RAY_OPTIONS,
  methodology: {
    trace:
      "Each sample recalculates all known rays without consulting a cache; process/JIT remain warm across samples.",
    memory:
      "50 in-memory SDK cache eligibility/geometry-validation samples; excludes browser painting.",
    serialized:
      "20 decode plus SDK validation samples, using the production cache codec.",
    database: database
      ? "5 production cache-store reads plus SDK validation per fixture; connection-local temporary tables and fixture orbital metadata, no HTTP/auth or stored-orbital join latency. No real orbital/cache rows are modified."
      : "Not measured; pass --database to enable temporary-table MySQL measurements.",
    limits:
      "Local Node timings are not a guarantee of browser latency. Network transfer, worker startup, and browser painting are excluded.",
  },
  cases: [],
};

let connection, db, store, disconnect;
try {
  if (database) {
    const mysql = await import("../servers/fracto-data-server/mysql.js");
    const { OrbitalRayPathStore } =
      await import("../servers/fracto-data-server/handlers/orbital_ray_paths.js");
    connection = mysql.db_connect();
    disconnect = mysql.db_disconnect;
    db = connection.promise();
    await db.query(
      "CREATE TEMPORARY TABLE orbital_progressions (id BIGINT UNSIGNED PRIMARY KEY)",
    );
    await db.query(
      "CREATE TEMPORARY TABLE orbital_ray_paths (orbital_id BIGINT UNSIGNED PRIMARY KEY, paths JSON NOT NULL)",
    );
    await db.query(
      "INSERT INTO orbital_progressions (id) VALUES (1),(2),(3),(4),(5)",
    );
    store = new OrbitalRayPathStore({
      connect: () => connection,
      disconnect: () => {},
      store: {
        get: async (id) =>
          fixtures.find((f) => f.orbital.orbital_id === id).orbital,
      },
    });
  }
  for (const fixture of fixtures) {
    let result;
    const cold = await repeated(runs, async () => {
      result = await trace_known_dynamic_rays(fixture.request);
      assert.equal(result.status, "rays_found", fixture.name);
      assert.equal(
        result.rays.length,
        fixture.request.requests.length,
        fixture.name,
      );
    });
    const cache = merge_orbital_ray_cache(null, fixture.request, result.rays);
    const encoded = await encode_ray_cache(cache);
    const validate = (value) => {
      assert.equal(
        cached_orbital_rays(value, fixture.request).length,
        result.rays.length,
      );
    };
    const memory = await repeated(50, () => validate(cache));
    const serialized = await repeated(20, async () =>
      validate(await decode_ray_cache(encoded)),
    );
    let database_save_ms = null,
      database_read = null;
    if (store) {
      database_save_ms = (
        await measure(() =>
          store.put(fixture.orbital.orbital_id, {
            version: ORBITAL_RAY_CACHE_VERSION,
            request: fixture.request,
            rays: result.rays,
            quality: SEED_SURVEY_RAY_OPTIONS,
          }),
        )
      ).ms;
      database_read = await repeated(5, async () =>
        validate(await store.get(fixture.orbital.orbital_id)),
      );
    }
    const row = {
      name: fixture.name,
      period: fixture.request.period,
      rays: result.rays.length,
      geometry_points: result.rays.reduce((n, r) => n + r.points.length, 0),
      max_landing_error: Math.max(...result.rays.map((r) => r.landing_error)),
      stored_bytes: Buffer.byteLength(encoded),
      cold,
      memory,
      serialized,
      database_save_ms,
      database_read,
    };
    report.cases.push(row);
    console.log(
      `${row.name}: ${row.rays} rays; trace ${cold.median_ms.toFixed(1)} ms; cached decode/validate ${serialized.median_ms.toFixed(2)} ms${database_read ? `; MySQL read/validate ${database_read.median_ms.toFixed(2)} ms` : ""}`,
    );
  }
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(`Benchmark report: ${output}`);
} finally {
  if (connection) disconnect(connection);
}
