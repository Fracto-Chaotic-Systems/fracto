import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import {
  require_enabled_user_if_configured,
  require_internal_service,
} from "../utils/service_authorization.js";

const previous_env = {
  auth_required: process.env.FRACTO_AUTH_REQUIRED,
  server_port: process.env.FRACTO_SERVER_PORT,
  token: process.env.FRACTO_INTERNAL_SERVICE_TOKEN,
};
let session_server;

before(async () => {
  session_server = createServer((req, res) => {
    const cookie = req.headers.cookie || "";
    res.setHeader("Content-Type", "application/json");
    if (cookie.includes("session=enabled")) {
      res.end(JSON.stringify({ authenticated: true, auth_state: "authenticated", user: { enabled: true } }));
    } else if (cookie.includes("session=disabled")) {
      res.end(JSON.stringify({ authenticated: true, auth_state: "denied", user: { enabled: false } }));
    } else {
      res.end(JSON.stringify({ authenticated: false, auth_state: "anonymous" }));
    }
  });
  await new Promise((resolve) => session_server.listen(0, "127.0.0.1", resolve));
  process.env.FRACTO_SERVER_PORT = `${session_server.address().port}`;
  process.env.FRACTO_AUTH_REQUIRED = "true";
  process.env.FRACTO_INTERNAL_SERVICE_TOKEN = "test-internal-service-token";
});

after(async () => {
  await new Promise((resolve) => session_server.close(resolve));
  for (const [name, value] of Object.entries({
    FRACTO_AUTH_REQUIRED: previous_env.auth_required,
    FRACTO_SERVER_PORT: previous_env.server_port,
    FRACTO_INTERNAL_SERVICE_TOKEN: previous_env.token,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const invoke = async (middleware, { cookie = "", token = "", method = "GET", origin } = {}) => {
  let status = 200;
  let body;
  let continued = false;
  const req = {
    method,
    headers: { cookie, ...(origin ? { origin } : {}) },
    get: (name) => name.toLowerCase() === "x-fracto-service-token" ? token : undefined,
  };
  const res = {
    status(code) { status = code; return this; },
    json(value) { body = value; return this; },
  };
  await middleware(req, res, () => { continued = true; });
  return { status, body, continued };
};

test("service APIs reject anonymous requests when authentication is required", async () => {
  const response = await invoke(require_enabled_user_if_configured);
  assert.equal(response.status, 401);
  assert.equal(response.continued, false);
});

test("service APIs reject authenticated but disabled users", async () => {
  const response = await invoke(require_enabled_user_if_configured, { cookie: "session=disabled" });
  assert.equal(response.status, 403);
  assert.equal(response.continued, false);
});

test("service APIs accept enabled users and supervisor service credentials", async () => {
  const enabled = await invoke(require_enabled_user_if_configured, { cookie: "session=enabled" });
  const internal = await invoke(require_enabled_user_if_configured, { token: "test-internal-service-token" });
  assert.equal(enabled.continued, true);
  assert.equal(internal.continued, true);
});

test("cookie-authenticated mutations require the configured UI origin", async () => {
  const missing_origin = await invoke(require_enabled_user_if_configured, {
    cookie: "session=enabled", method: "POST",
  });
  const trusted_origin = await invoke(require_enabled_user_if_configured, {
    cookie: "session=enabled", method: "POST", origin: "http://localhost:3006",
  });
  assert.equal(missing_origin.status, 403);
  assert.equal(trusted_origin.continued, true);
});

test("internal service routes reject missing or incorrect credentials", async () => {
  assert.equal((await invoke(require_internal_service)).status, 403);
  assert.equal((await invoke(require_internal_service, { token: "wrong" })).status, 403);
  assert.equal((await invoke(require_internal_service, { token: "test-internal-service-token" })).continued, true);
});
