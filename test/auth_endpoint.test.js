import assert from "node:assert/strict";
import express from "express";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { after, before, describe, test } from "node:test";

import {
  handle_auth_callback,
  handle_auth_login,
  handle_auth_logout,
  handle_auth_session,
  require_authenticated,
  require_enabled_user,
} from "../handlers/auth.js";
import { AUTH_COOKIE_NAME, create_session as store_session, get_session } from "../utils/auth_sessions.js";
import { require_administrator } from "../utils/admin_authorization.js";
import {
  require_enabled_user_if_configured,
  require_internal_service,
} from "../utils/service_authorization.js";

const users = new Map();
const create_session = (user) => {
  user = { provider_subject: `subject-${user.id}`, ...user };
  users.set(`${user.id}`, { ...user });
  return store_session(user);
};
let lookup_unavailable = false;
const data_app = express();
data_app.get("/user/session/:id", (req, res) => {
  if (lookup_unavailable) return res.sendStatus(503);
  const user = users.get(req.params.id);
  return user ? res.json({ user }) : res.sendStatus(404);
});
data_app.post("/login_event", (req, res) => res.sendStatus(201));
// Mount the data service's actual route declarations with database handlers
// replaced by markers, retaining its real authorization middleware.
const data_routes = readFileSync(new URL("../servers/fracto-data-server/index.js", import.meta.url), "utf8");
const route_source = data_routes.slice(data_routes.indexOf('app.get("/",'));
const route_globals = {
  app: data_app,
  require_administrator,
  require_enabled_user_if_configured,
  require_internal_service,
  process,
};
for (const name of new Set(route_source.match(/\bhandle_\w+/g))) {
  route_globals[name] = (req, res) => res.json({ handler: name });
}
data_app.use(express.json());
vm.runInNewContext(route_source, route_globals);
let data_server;
const previous_data_port = process.env.FRACTO_DATA_PORT;
const previous_main_port = process.env.FRACTO_SERVER_PORT;
const previous_auth_required = process.env.FRACTO_AUTH_REQUIRED;
const ui_origin = process.env.FRACTO_UI_ORIGIN || "http://localhost:3006";

const app = express();
app.get("/auth/login", handle_auth_login);
app.get("/auth/callback", handle_auth_callback);
app.get("/auth/session", handle_auth_session);
app.post("/auth/logout", handle_auth_logout);
app.get("/protected", require_authenticated, (req, res) =>
  res.json({ user_id: req.auth_user.id }),
);
app.get("/enabled", require_enabled_user, (req, res) =>
  res.json({ user_id: req.auth_user.id }),
);
let server;
let base_url;
app.get("/admin", require_administrator, (req, res) => res.json({ ok: true }));

before(
  () =>
    new Promise((resolve) => {
      data_server = data_app.listen(0, () => {
        process.env.FRACTO_DATA_PORT = `${data_server.address().port}`;
      process.env.FRACTO_AUTH_REQUIRED = "true";
      server = app.listen(0, () => {
        base_url = `http://127.0.0.1:${server.address().port}`;
        process.env.FRACTO_SERVER_PORT = `${server.address().port}`;
        resolve();
      });
      });
    }),
);

after(async () => {
  await Promise.all([server, data_server].map((listener) => new Promise((resolve) => listener.close(resolve))));
  if (previous_data_port === undefined) delete process.env.FRACTO_DATA_PORT;
  else process.env.FRACTO_DATA_PORT = previous_data_port;
  if (previous_main_port === undefined) delete process.env.FRACTO_SERVER_PORT;
  else process.env.FRACTO_SERVER_PORT = previous_main_port;
  if (previous_auth_required === undefined) delete process.env.FRACTO_AUTH_REQUIRED;
  else process.env.FRACTO_AUTH_REQUIRED = previous_auth_required;
});

describe("authentication endpoint contract", () => {
  test("reports an anonymous session without exposing credentials", async () => {
    const response = await fetch(`${base_url}/auth/session`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.authenticated, false);
    assert.equal(body.auth_state, "anonymous");
    assert.equal(body.user, null);
    assert.equal(Object.hasOwn(body, "access_token"), false);
  });

  test("reports that provider login is unavailable until configured", async () => {
    const response = await fetch(`${base_url}/auth/login`);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.match(body.error, /not configured/);
  });

  test("keeps logout idempotent without a session", async () => {
    const response = await fetch(`${base_url}/auth/logout`, { method: "POST", headers: { Origin: ui_origin } });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
  });

  test("returns a validated server-side session without credentials", async () => {
    const { token } = create_session({
      id: 7,
      provider: "test",
      provider_subject: "subject-7",
      email: "user@example.com",
      display_name: "Test User",
      role: null,
      access_token: "must-not-leak",
    });
    const response = await fetch(`${base_url}/auth/session`, {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}` },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.authenticated, true);
    assert.equal(body.auth_state, "denied");
    assert.equal(body.user.email, "user@example.com");
    assert.equal(Object.hasOwn(body.user, "access_token"), false);
    assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  });

  test("logout invalidates the server-side session", async () => {
    const { token } = create_session({ id: 8, provider: "test" });
    const logout = await fetch(`${base_url}/auth/logout`, {
      method: "POST",
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}`, Origin: ui_origin },
    });
    assert.equal(logout.status, 200);

    const response = await fetch(`${base_url}/auth/session`, {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}` },
    });
    const body = await response.json();
    assert.equal(body.authenticated, false);
  });

  test("reports enabled access separately from session validity", async () => {
    const { token } = create_session({ id: 11, provider: "test", enabled: true });
    const response = await fetch(`${base_url}/auth/session`, {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}` },
    });
    const body = await response.json();
    assert.equal(body.authenticated, true);
    assert.equal(body.auth_state, "authenticated");
    assert.equal(body.user.enabled, true);
  });

  test("uses the same unavailable contract for the callback", async () => {
    const response = await fetch(`${base_url}/auth/callback`);
    assert.equal(response.status, 503);
  });

  test("rejects protected routes without a session", async () => {
    const response = await fetch(`${base_url}/protected`);
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.error, "Authentication required");
  });

  test("treats malformed cookies as anonymous", async () => {
    const response = await fetch(`${base_url}/auth/session`, {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=%E0%A4%A` },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.authenticated, false);
  });

  test("distinguishes disabled users from anonymous requests", async () => {
    const { token } = create_session({ id: 9, provider: "test", enabled: false });
    const response = await fetch(`${base_url}/enabled`, {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}` },
    });
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.error, "User access is not enabled");
  });

  test("allows enabled users through the protected middleware", async () => {
    const { token } = create_session({ id: 10, provider: "test", enabled: true });
    const response = await fetch(`${base_url}/enabled`, {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}` },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.user_id, 10);
  });

  test("disabling a previously enabled user denies the next request", async () => {
    const { token } = create_session({ id: 20, provider: "test", enabled: 1, role: "admin" });
    const headers = { Cookie: `${AUTH_COOKIE_NAME}=${token}` };
    assert.equal((await fetch(`${base_url}/enabled`, { headers })).status, 200);
    users.get("20").enabled = 0;
    assert.equal((await fetch(`${base_url}/enabled`, { headers })).status, 403);
    assert.equal((await fetch(`${base_url}/admin`, { headers })).status, 403);
    const session = await (await fetch(`${base_url}/auth/session`, { headers })).json();
    assert.equal(session.auth_state, "denied");
    assert.equal(session.user.enabled, false);
  });

  test("admin operations reject anonymous and non-admin users and recheck role", async () => {
    assert.equal((await fetch(`${base_url}/admin`)).status, 401);
    const { token } = create_session({ id: 21, provider: "test", enabled: true, role: null });
    const headers = { Cookie: `${AUTH_COOKIE_NAME}=${token}` };
    assert.equal((await fetch(`${base_url}/admin`, { headers })).status, 403);
    users.get("21").role = "admin";
    assert.equal((await fetch(`${base_url}/admin`, { headers })).status, 200);
    users.get("21").role = null;
    assert.equal((await fetch(`${base_url}/admin`, { headers })).status, 403);
  });

  test("lookup failure fails closed rather than trusting cached access", async () => {
    const { token } = create_session({ id: 22, provider: "test", enabled: true, role: "admin" });
    const headers = { Cookie: `${AUTH_COOKIE_NAME}=${token}` };
    lookup_unavailable = true;
    try {
      for (const route of ["/enabled", "/auth/session", "/admin"]) {
        assert.equal((await fetch(`${base_url}${route}`, { headers })).status, 503);
      }
    } finally { lookup_unavailable = false; }
  });

  test("deleted or replaced identities invalidate the old session", async () => {
    for (const replaced of [false, true]) {
      const { token } = create_session({ id: 23, provider: "test", provider_subject: "original", enabled: true });
      if (replaced) users.get("23").provider_subject = "replacement";
      else users.delete("23");
      const response = await fetch(`${base_url}/enabled`, { headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}` } });
      assert.equal(response.status, 401);
    }
  });

  test("direct data user and maintenance routes require an enabled administrator", async () => {
    const routes = [
      ["GET", "/users"], ["GET", "/login_events"],
      ["PUT", "/user/30"], ["GET", "/query?table=users"],
      ["POST", "/backup?table=users"], ["POST", "/ensure_table"],
    ];
    const { token } = create_session({ id: 30, provider: "test", enabled: 1, role: "admin" });
    for (const [method, path] of routes) {
      const options = { method, headers: { "Content-Type": "application/json", Origin: ui_origin } };
      if (method === "POST") options.body = JSON.stringify({ table: "USERS", columns: [] });
      if (method === "PUT") options.body = JSON.stringify({ enabled: true });
      const url = `http://127.0.0.1:${data_server.address().port}${path}`;
      assert.equal((await fetch(url, options)).status, 401, path);
      options.headers.Cookie = `${AUTH_COOKIE_NAME}=${token}`;
      users.get("30").enabled = 0;
      assert.equal((await fetch(url, options)).status, 403, path);
      users.get("30").enabled = 1;
      users.get("30").role = null;
      assert.equal((await fetch(url, options)).status, 403, path);
      users.get("30").role = "admin";
      assert.equal((await fetch(url, options)).status, 200, path);
    }
  });

  test("general data APIs require an enabled user but do not require an admin role", async () => {
    const routes = ["/fracto_calc", "/assets", "/automation"];
    for (const route of routes) {
      const url = `http://127.0.0.1:${data_server.address().port}${route}`;
      assert.equal((await fetch(url)).status, 401, route);
      const { token } = create_session({ id: 31, provider: "test", enabled: 1, role: null });
      const response = await fetch(url, {
        headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}` },
      });
      assert.equal(response.status, 200, route);
    }
  });

  test("only the fixed welcome-image query remains public", async () => {
    const data_origin = `http://127.0.0.1:${data_server.address().port}`;
    assert.equal((await fetch(`${data_origin}/assets?asset_type=image&width=4800&height=4800`)).status, 200);
    assert.equal((await fetch(`${data_origin}/assets?asset_type=image&width=4800&height=4800&limit=1000`)).status, 401);
  });

  test("expired and unknown tokens are anonymous and cannot access protected endpoints", async () => {
    const expired = create_session({ id: 40, provider: "test", enabled: 1, role: "admin" });
    get_session(expired.token).expires_at = Date.now() - 1;
    for (const token of [expired.token, "unknown-session-token"]) {
      const headers = { Cookie: `${AUTH_COOKIE_NAME}=${token}` };
      for (const route of ["/protected", "/enabled", "/admin"]) {
        assert.equal((await fetch(`${base_url}${route}`, { headers })).status, 401);
      }
      const session = await (await fetch(`${base_url}/auth/session`, { headers })).json();
      assert.equal(session.auth_state, "anonymous");
      assert.equal(session.user, null);
    }
  });

  test("logout rejects the old cookie while a subsequent login can establish access", async () => {
    const user = { id: 41, provider: "test", enabled: 1 };
    const old = create_session(user);
    const headers = { Cookie: `${AUTH_COOKIE_NAME}=${old.token}`, Origin: ui_origin };
    assert.equal((await fetch(`${base_url}/enabled`, { headers })).status, 200);
    assert.equal((await fetch(`${base_url}/auth/logout`, { method: "POST", headers })).status, 200);
    assert.equal((await fetch(`${base_url}/enabled`, { headers })).status, 401);
    const next = create_session(user);
    assert.notEqual(next.token, old.token);
    assert.equal((await fetch(`${base_url}/enabled`, {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${next.token}` },
    })).status, 200);
  });
});
