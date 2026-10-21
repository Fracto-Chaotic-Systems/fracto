import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  encode_ray_cache,
  decode_ray_cache,
} from "../servers/fracto-data-server/handlers/minibrot_ray_codec.js";
import {
  ray_cache_identity,
  ray_cache_matches,
  merge_ray_cache,
  MAX_RAY_GROUP_BYTES,
} from "../sdk/orbitals/FractoMinibrotRayCache.js";
import { RAY_CACHE_VERSION } from "../sdk/orbitals/FractoMinibrotRayCache.js";
import { readFileSync } from "node:fs";
const handler_source = readFileSync(
  new URL(
    "../servers/fracto-data-server/handlers/minibrot_ray_paths.js",
    import.meta.url,
  ),
  "utf8",
)
  .replace(/^import[\s\S]*?;\r?\n/gm, "")
  .replace(/export /g, "");
const create_minibrot_ray_handlers = vm.runInNewContext(
  handler_source + ";create_minibrot_ray_handlers",
  {
    db_connect: () => {},
    db_disconnect: () => {},
    ray_cache_identity,
    ray_cache_matches,
    merge_ray_cache,
    MAX_RAY_GROUP_BYTES,
    RAY_CACHE_VERSION,
    Buffer,
    console,
    encode_ray_cache,
    decode_ray_cache,
  },
);
const response = () => ({
  statusCode: 200,
  status(n) {
    this.statusCode = n;
    return this;
  },
  json(data) {
    this.body = data;
    return this;
  },
});
const result = {
  status: "complete",
  root: { x: -1.25, y: 0 },
  rays: ["2/5", "3/5"].map((key) => ({
    angle: {
      key,
      numerator: key[0],
      denominator: "5",
      value: Number(key[0]) / 5,
    },
    points: [
      { x: -2, y: 0 },
      { x: -1.25, y: 0 },
    ],
    landed: true,
    endpoint_error: 0.001,
  })),
};
function store() {
  const row = {
      id: 7,
      pattern: 2,
      core_point: JSON.stringify({ x: -1, y: 0 }),
      ray_paths: null,
    },
    events = [];
  let lock = Promise.resolve();
  const handlers = create_minibrot_ray_handlers({
    connect: () => {
      let release;
      return {
        promise: () => ({
          async beginTransaction() {
            const prior = lock;
            lock = new Promise((resolve) => (release = resolve));
            await prior;
            events.push("begin");
          },
          async query(sql, values) {
            events.push(sql);
            if (sql.startsWith("SELECT")) return [[{ ...row }]];
            row.ray_paths = values[0];
            return [{ affectedRows: 1 }];
          },
          async commit() {
            events.push("commit");
            release?.();
          },
          async rollback() {
            events.push("rollback");
            release?.();
          },
        }),
      };
    },
    disconnect: () => events.push("close"),
  });
  const req = (group = "doubling") => ({
    params: { id: "7" },
    body: {
      version: RAY_CACHE_VERSION,
      core_point: { x: -1, y: 0 },
      period: 2,
      tolerance: 0.002,
      group,
      result,
    },
  });
  return { row, events, handlers, req };
}
test("record ray cache is lazy, and concurrent groups are merged under a row lock", async () => {
  const h = store(),
    empty = response();
  await h.handlers.get(h.req(), empty);
  assert.equal(empty.body.result, null);
  const a = response(),
    b = response();
  await Promise.all([
    h.handlers.put(h.req(), a),
    h.handlers.put(h.req("root_access"), b),
  ]);
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  const cache = JSON.parse(h.row.ray_paths);
  assert.deepEqual(Object.keys(cache.groups).sort(), [
    "doubling",
    "root_access",
  ]);
  assert.ok(h.events.some((e) => e.includes("FOR UPDATE")));
  assert.ok(
    h.events
      .filter((e) => e.startsWith("UPDATE"))
      .every((e) => e.includes("updated_at = updated_at")),
  );
  const read = response();
  await h.handlers.get(h.req(), read);
  assert.equal(read.body.result.version, RAY_CACHE_VERSION);
});
test("changed records and invalid writes do not update the cache", async () => {
  const h = store(),
    req = h.req();
  req.body.core_point.x = -2;
  const res = response();
  await h.handlers.put(req, res);
  assert.equal(res.statusCode, 409);
  assert.equal(h.row.ray_paths, null);
  assert.ok(h.events.includes("rollback"));
  const invalid = h.req();
  invalid.body.result = { status: "complete", rays: [] };
  const bad = response();
  await h.handlers.put(invalid, bad);
  assert.equal(bad.statusCode, 400);
});
test("missing migration is reported without changing data", async () => {
  const handlers = create_minibrot_ray_handlers({
    connect: () => ({
      promise: () => ({
        query: async () => {
          throw Object.assign(Error("missing"), { code: "ER_BAD_FIELD_ERROR" });
        },
      }),
    }),
    disconnect: () => {},
  });
  const res = response();
  await handlers.get({ params: { id: 7 } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "ray_cache_schema_pending");
});
test("invalid ids are rejected and stale algorithm versions read as a cache miss", async () => {
  const h = store(),
    res = response();
  await h.handlers.get({ params: { id: "bad" } }, res);
  assert.equal(res.statusCode, 400);
  h.row.ray_paths = JSON.stringify({ version: "old" });
  const stale = response();
  await h.handlers.get(h.req(), stale);
  assert.equal(stale.body.result, null);
});
test("list responses explicitly exclude geometry, and cache routes retain normal authentication", () => {
  const lists = readFileSync(
    new URL(
      "../servers/fracto-data-server/handlers/minibrots.js",
      import.meta.url,
    ),
    "utf8",
  );
  const columns = lists.match(/MINIBROT_LIST_COLUMNS\s*=\s*"([^"]+)"/)[1];
  assert.ok(!columns.includes("ray_paths"));
  assert.ok(columns.includes("core_point"));
  const index = readFileSync(
    new URL("../servers/fracto-data-server/index.js", import.meta.url),
    "utf8",
  );
  assert.ok(
    index.indexOf("require_enabled_user_if_configured(req") <
      index.indexOf('app.put("/minibrot/:id/ray-paths"'),
  );
});

test("large cache geometry compresses losslessly and small JSON remains readable", async () => {
  const cache = {
    version: RAY_CACHE_VERSION,
    groups: { large: "geometry".repeat(200000) },
  };
  const encoded = await encode_ray_cache(cache);
  assert.equal(JSON.parse(encoded).encoding, "gzip-base64");
  assert.deepEqual(await decode_ray_cache(encoded), cache);
  const small = { groups: {} };
  assert.deepEqual(JSON.parse(await encode_ray_cache(small)), small);
});
