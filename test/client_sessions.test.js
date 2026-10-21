import assert from "node:assert/strict";
import { test } from "node:test";
import {
  create_session,
  get_session,
  renew_session,
  destroy_session,
  list_client_sessions,
  SESSION_TTL_MS,
} from "../utils/auth_sessions.js";
import { create_clients_handler } from "../handlers/clients.js";
import { is_lab_readonly_admin_bypass } from "../utils/admin_authorization.js";

test("client snapshots track activity, omit secrets, copy fields and expire", () => {
  const original = Date.now;
  let now = original();
  Date.now = () => now;
  let token;
  try {
    ({ token } = create_session(
      {
        id: 7,
        display_name: "Lab user",
        role: "admin",
        email: "secret@example",
        provider_subject: "secret-subject",
      },
      { user_agent: "Test browser" },
    ));
    const id = get_session(token).client_id;
    now += 1000;
    renew_session(token);
    const record = list_client_sessions().find((client) => client.id === id);
    assert.equal(record.user_agent, "Test browser");
    assert.equal(record.last_seen_at, new Date(now).toISOString());
    assert.equal(record.created_at, new Date(now - 1000).toISOString());
    const serialized = JSON.stringify(record);
    assert.ok(!serialized.includes(token));
    assert.ok(!serialized.includes("secret@example"));
    assert.ok(!serialized.includes("secret-subject"));
    record.user.display_name = "changed snapshot";
    assert.equal(get_session(token).user.display_name, "Lab user");
    now += SESSION_TTL_MS + 1;
    assert.ok(!list_client_sessions().some((client) => client.id === id));
  } finally {
    if (token) destroy_session(token);
    Date.now = original;
  }
});

const response = () => ({
  headers: {},
  setHeader(key, value) {
    this.headers[key] = value;
  },
  json(value) {
    this.body = value;
    return this;
  },
  status(value) {
    this.code = value;
    return this;
  },
});

test("client endpoint authorizes before reading any records", async () => {
  let reads = 0;
  const blocked = create_clients_handler({
    authorize: async (_req, res) =>
      res.status(403).json({ error: "Forbidden" }),
    lab_bypass: () => false,
    list: () => {
      reads++;
      return [];
    },
  });
  const res = response();
  await blocked({}, res);
  assert.equal(res.code, 403);
  assert.equal(reads, 0);
  assert.equal(res.headers["Cache-Control"], "no-store");
  const allowed = create_clients_handler({
    authorize: async (_req, _res, next) => next(),
    lab_bypass: () => false,
    list: () => [],
  });
  const ok = response();
  await allowed({}, ok);
  assert.deepEqual(ok.body, { contract_version: 1, clients: [] });
});

test("lab client access requires the explicit existing read-only bypass", () => {
  const env = {
    FRACTO_AUTH_MODE: "none",
    FRACTO_AUTH_REQUIRED: "false",
    FRACTO_ADMIN_READONLY_BYPASS: "true",
  };
  assert.equal(
    is_lab_readonly_admin_bypass({ method: "GET", path: "/clients" }, env),
    true,
  );
  assert.equal(
    is_lab_readonly_admin_bypass({ method: "POST", path: "/clients" }, env),
    false,
  );
  assert.equal(
    is_lab_readonly_admin_bypass(
      { method: "GET", path: "/clients" },
      { ...env, FRACTO_ADMIN_READONLY_BYPASS: "false" },
    ),
    false,
  );
  assert.equal(
    is_lab_readonly_admin_bypass(
      { method: "GET", path: "/clients" },
      { ...env, FRACTO_AUTH_REQUIRED: "true" },
    ),
    false,
  );
});
