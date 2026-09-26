import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as sessions from "../utils/auth_sessions.js";
import * as transactions from "../utils/auth_transactions.js";
import { trusted_mutation_origin } from "../utils/auth_request_origin.js";
import { get_auth_config } from "../utils/auth_config.js";

const response = () => ({
  headers: {}, code: 200,
  getHeader(name) { return this.headers[name]; },
  setHeader(name, value) { this.headers[name] = value; },
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; },
  redirect(url) { this.url = new URL(url); },
});
const ui_origin = process.env.FRACTO_UI_ORIGIN || "http://localhost:3006";
const source = readFileSync(new URL("../handlers/auth.js", import.meta.url), "utf8")
  .replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
const harness = (overrides = {}) => vm.runInNewContext(
  `${source}\n({handle_auth_callback, handle_auth_logout, safe_return_to, require_enabled_user_if_configured})`, {
    ...sessions, ...transactions, trusted_mutation_origin,
    URL, AbortSignal, process, console: { error() {}, warn() {} },
    get_auth_config: () => ({ mode: "oidc", required: true, configured: true,
      ui_origin, issuer: "https://accounts.google.com", client_id: "test",
      redirect_uri: "http://localhost:3001/auth/callback" }),
    discover_oidc_provider: async () => ({ configuration: {} }),
    oidc: { authorizationCodeGrant: async () => ({ claims: () => ({}) }) },
    normalize_oidc_identity: () => ({ provider: "google", provider_subject: "test" }),
    fetch: async () => ({ ok: true, json: async () => ({ user: {
      id: 1, provider: "google", provider_subject: "test", enabled: 1,
    } }) }),
    ...overrides,
  },
);
const transaction = () => transactions.create_auth_transaction({
  nonce: "nonce", code_verifier: "verifier", return_to: "/study",
});
const request = (tx, query = {}) => ({ method: "GET", query: { state: tx.state, ...query },
  headers: { cookie: `${transactions.AUTH_TRANSACTION_COOKIE_NAME}=${tx.state}` },
  get: () => "test-agent", ip: "127.0.0.1",
});

test("return destinations reject external origins, backslashes, and control characters", () => {
  const { safe_return_to } = harness();
  for (const path of ["//evil.example", "/\\evil.example", "/\n/evil.example", "https://evil.example", ["/study"]]) {
    assert.equal(safe_return_to(path), "/");
  }
  assert.equal(safe_return_to("/study?view=1#point"), "/study?view=1#point");
});

test("missing, expired, and mismatched state fail without consuming another browser's transaction", async () => {
  const { handle_auth_callback } = harness();
  const tx = transaction();
  const wrong = request(tx, { code: "code" });
  wrong.headers.cookie = `${transactions.AUTH_TRANSACTION_COOKIE_NAME}=different`;
  const res = response();
  await handle_auth_callback(wrong, res);
  assert.equal(res.url.searchParams.get("auth_error"), "invalid_state");
  assert.equal(transactions.get_auth_transaction(tx.state), tx);
  tx.expires_at = Date.now() - 1;
  for (const req of [request(tx), { query: {}, headers: {} }]) {
    const result = response();
    await handle_auth_callback(req, result);
    assert.equal(result.url.pathname, "/");
    assert.equal(result.url.searchParams.get("auth_error"), "invalid_state");
  }
});

test("provider denial and missing code consume state and return safe welcome errors", async () => {
  for (const [query, expected] of [[{ error: "access_denied", error_description: "secret" }, "access_denied"], [{}, "missing_code"]]) {
    const tx = transaction();
    const res = response();
    await harness().handle_auth_callback(request(tx, query), res);
    assert.equal(res.url.pathname, "/");
    assert.equal(res.url.searchParams.get("auth_error"), expected);
    assert.equal(res.url.href.includes("secret"), false);
    assert.equal(transactions.get_auth_transaction(tx.state), null);
  }
});

test("successful callback rotates the old session and cannot be replayed", async () => {
  const tx = transaction();
  const old = sessions.create_session({ id: 1 });
  const req = request(tx, { code: "code" });
  req.headers.cookie += `; ${sessions.AUTH_COOKIE_NAME}=${old.token}`;
  const res = response();
  const handler = harness().handle_auth_callback;
  await handler(req, res);
  assert.equal(res.url.pathname, "/study");
  assert.equal(sessions.get_session(old.token), null);
  assert.equal(res.headers["Set-Cookie"].length, 2);
  const replay = response();
  await handler(req, replay);
  assert.equal(replay.url.searchParams.get("auth_error"), "invalid_state");
  assert.equal(replay.headers["Set-Cookie"].some((cookie) => cookie.startsWith(`${sessions.AUTH_COOKIE_NAME}=`)), false);
});

test("token exchange and provisioning failures return safe errors without a session", async () => {
  for (const [overrides, expected] of [
    [{ oidc: { authorizationCodeGrant: async () => { throw new Error("private token error"); } } }, "token_exchange_failed"],
    [{ fetch: async () => ({ ok: false, json: async () => ({ error: "private database error" }) }) }, "user_provisioning_failed"],
  ]) {
    const tx = transaction();
    const res = response();
    await harness(overrides).handle_auth_callback(request(tx, { code: "code" }), res);
    assert.equal(res.url.searchParams.get("auth_error"), expected);
    assert.equal(res.headers["Set-Cookie"].some((cookie) => cookie.startsWith(`${sessions.AUTH_COOKIE_NAME}=`)), false);
  }
});

test("mutations reject missing, null, and foreign origins", () => {
  for (const origin of [undefined, "null", "https://evil.example"]) {
    const res = response();
    assert.equal(trusted_mutation_origin({ method: "POST", headers: { origin } }, res), false);
    assert.equal(res.code, 403);
  }
  assert.equal(trusted_mutation_origin({ method: "PUT", headers: { origin: ui_origin } }, response()), true);
});

test("logout invalidates immediately even while audit is pending, and rejects forged logout", async () => {
  const session = sessions.create_session({ id: 1 });
  const tx = transaction();
  const req = request(tx);
  req.method = "POST";
  req.headers.cookie += `; ${sessions.AUTH_COOKIE_NAME}=${session.token}`;
  const rejected = response();
  await harness().handle_auth_logout(req, rejected);
  assert.equal(rejected.code, 403);
  assert.ok(sessions.get_session(session.token));
  req.headers.origin = ui_origin;
  let finish_audit;
  const handler = harness({ fetch: () => new Promise((resolve) => { finish_audit = resolve; }) }).handle_auth_logout;
  const res = response();
  const pending = handler(req, res);
  assert.equal(sessions.get_session(session.token), null);
  assert.equal(transactions.get_auth_transaction(tx.state), null);
  finish_audit({ ok: false });
  await pending;
  assert.equal(res.code, 200);
  assert.equal(res.headers["Set-Cookie"].every((cookie) => cookie.includes("Max-Age=0")), true);
});

test("expired sessions cannot be renewed and cookies retain production restrictions", () => {
  const session = sessions.create_session({ id: 1 });
  sessions.get_session(session.token).expires_at = Date.now() - 1;
  assert.equal(sessions.renew_session(session.token), null);
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const res = response();
    sessions.set_session_cookie(res, "opaque");
    transactions.set_auth_transaction_cookie(res, "state");
    for (const cookie of res.headers["Set-Cookie"]) {
      for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) assert.ok(cookie.includes(flag));
      assert.equal(cookie.includes("Domain="), false);
    }
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("deployment gate enforces true and preserves false/unset bypass", async () => {
  const previous = process.env.FRACTO_AUTH_REQUIRED;
  try {
    for (const value of ["true", "false", undefined]) {
      if (value === undefined) delete process.env.FRACTO_AUTH_REQUIRED;
      else process.env.FRACTO_AUTH_REQUIRED = value;
      const handler = harness({ get_auth_config }).require_enabled_user_if_configured;
      const res = response();
      let passed = false;
      await handler({ method: "GET", headers: {} }, res, () => { passed = true; });
      assert.equal(passed, value !== "true");
      if (value === "true") assert.equal(res.code, 401);
    }
  } finally {
    if (previous === undefined) delete process.env.FRACTO_AUTH_REQUIRED;
    else process.env.FRACTO_AUTH_REQUIRED = previous;
  }
});
