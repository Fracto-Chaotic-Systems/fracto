import assert from "node:assert/strict";
import express from "express";
import { after, before, describe, test } from "node:test";

import {
  handle_auth_callback,
  handle_auth_login,
  handle_auth_logout,
  handle_auth_session,
  require_authenticated,
  require_enabled_user,
} from "../handlers/auth.js";
import { AUTH_COOKIE_NAME, create_session } from "../utils/auth_sessions.js";

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

before(
  () =>
    new Promise((resolve) => {
      server = app.listen(0, () => {
        base_url = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    }),
);

after(() => new Promise((resolve) => server.close(resolve)));

describe("authentication endpoint contract", () => {
  test("reports an anonymous session without exposing credentials", async () => {
    const response = await fetch(`${base_url}/auth/session`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.authenticated, false);
    assert.equal(body.user, null);
    assert.equal(Object.hasOwn(body, "access_token"), false);
  });

  test("reports that provider login is unavailable until configured", async () => {
    const response = await fetch(`${base_url}/auth/login`);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.match(body.error, /not configured/);
  });

  test("keeps logout idempotent before sessions are implemented", async () => {
    const response = await fetch(`${base_url}/auth/logout`, { method: "POST" });
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
    assert.equal(body.user.email, "user@example.com");
    assert.equal(Object.hasOwn(body.user, "access_token"), false);
    assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  });

  test("logout invalidates the server-side session", async () => {
    const { token } = create_session({ id: 8, provider: "test" });
    const logout = await fetch(`${base_url}/auth/logout`, {
      method: "POST",
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}` },
    });
    assert.equal(logout.status, 200);

    const response = await fetch(`${base_url}/auth/session`, {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}` },
    });
    const body = await response.json();
    assert.equal(body.authenticated, false);
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
});
