import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

const handler = (file, name, select) => {
  const source = readFileSync(
    new URL(`../servers/fracto-data-server/handlers/${file}`, import.meta.url),
    "utf8",
  )
    .replace(/^import .*;\r?\n/gm, "")
    .replace(/export const /g, "const ");
  let opened = 0;
  let closed = 0;
  const handle = vm.runInNewContext(source + `;${name}`, {
    MINIBROT_LIST_COLUMNS: "id,name",
    db_connect: () => {
      opened++;
      return {};
    },
    db_disconnect: () => {
      closed++;
    },
    select,
    console: { log() {}, error() {} },
  });
  return { handle, counts: () => ({ opened, closed }) };
};
const response = () => ({
  status_code: 200,
  body: null,
  status(value) {
    this.status_code = value;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("Tiles query uses its short-code primary key, retains the limit, and returns rows", () => {
  const route = handler(
    "handle_query.js",
    "handle_query",
    (_db, query, callback) => {
      assert.equal(query.table, "tiles");
      assert.equal(query.order, "short_code DESC");
      assert.equal(query.limit, 1000);
      callback([{ short_code: "001" }]);
    },
  );
  const res = response();
  route.handle({ query: { table: "tiles", order: "id DESC" } }, res);
  assert.equal(res.status_code, 200);
  assert.equal(res.body.result[0].short_code, "001");
  assert.deepEqual(route.counts(), { opened: 1, closed: 1 });
});

test("other query tables keep ID ordering and unknown tables never access MySQL", () => {
  const route = handler(
    "handle_query.js",
    "handle_query",
    (_db, query, callback) => {
      assert.equal(query.order, "id DESC");
      callback([]);
    },
  );
  route.handle({ query: { table: "assets" } }, response());
  const res = response();
  route.handle({ query: { table: "tiles_seed" } }, res);
  assert.equal(res.status_code, 400);
  assert.deepEqual(route.counts(), { opened: 1, closed: 1 });
});

test("missing live table is reported as an error rather than silently returning staging rows", () => {
  const route = handler(
    "handle_query.js",
    "handle_query",
    (_db, query, callback) => {
      assert.equal(query.table, "tiles");
      callback({
        error: { code: "ER_NO_SUCH_TABLE", message: "tiles is missing" },
      });
    },
  );
  const res = response();
  route.handle({ query: { table: "tiles" } }, res);
  assert.equal(res.status_code, 500);
  assert.equal(res.body.error, "tiles is missing");
  assert.deepEqual(route.counts(), { opened: 1, closed: 1 });
});

test("dedicated tile listing also uses the short-code primary key", () => {
  const route = handler(
    "handle_tiles.js",
    "handle_tiles",
    (_db, query, callback) => {
      assert.equal(query.order, "short_code DESC");
      callback([]);
    },
  );
  route.handle({ query: {} }, response());
  assert.deepEqual(route.counts(), { opened: 1, closed: 1 });
});
