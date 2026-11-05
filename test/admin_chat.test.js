import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { create_chat_router } from "../servers/fracto-admin-server/handlers/chat.js";
import { create_app } from "../servers/fracto-ai-server/app.js";
import { InferenceService } from "../servers/fracto-ai-server/inference/service.js";
import { create_chat_attachment_adapter } from "../servers/fracto-ui/src/pages/admin/chat_attachments.js";
import { prepare_chat_messages } from "../servers/fracto-ui/src/pages/admin/chat_messages.js";

const token = "a".repeat(64);
const body = {
  contract_version: 1,
  messages: [{ role: "user", content: "Hello" }],
};
const reply = {
  contract_version: 1,
  message: { role: "assistant", content: "Hello back" },
};
let session_server;
const previous = {
  port: process.env.FRACTO_SERVER_PORT,
  origin: process.env.FRACTO_UI_ORIGIN,
};
before(async () => {
  process.env.FRACTO_UI_ORIGIN = "http://localhost:3006";
  session_server = express()
    .get("/auth/session", (req, res) => {
      const role = req.headers.cookie?.includes("admin") ? "admin" : "user";
      const enabled = !req.headers.cookie?.includes("disabled");
      res.json({
        authenticated: !!req.headers.cookie,
        auth_state: "authenticated",
        user: { role, enabled },
      });
    })
    .listen(0, "127.0.0.1");
  await new Promise((resolve) => session_server.once("listening", resolve));
  process.env.FRACTO_SERVER_PORT = String(session_server.address().port);
});
after(async () => {
  await new Promise((resolve) => session_server.close(resolve));
  for (const [key, value] of [
    ["FRACTO_SERVER_PORT", previous.port],
    ["FRACTO_UI_ORIGIN", previous.origin],
  ]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const fixture = async (t, options = {}) => {
  const calls = [];
  let credential_reads = 0;
  const app = express();
  app.use(
    "/chat",
    create_chat_router({
      environment: { FRACTO_AI_PORT: "3107" },
      get_token: async () => {
        credential_reads++;
        return token;
      },
      fetch_ai: async (...args) => {
        calls.push(args);
        return Response.json(reply);
      },
      ...options,
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    calls,
    get credential_reads() {
      return credential_reads;
    },
    request: (content = body, headers = {}, query = "", signal) =>
      fetch(`http://127.0.0.1:${server.address().port}/chat${query}`, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          origin: "http://localhost:3006",
          cookie: "session=admin",
          ...headers,
        },
        body: typeof content === "string" ? content : JSON.stringify(content),
      }),
  };
};

test("chat checks origin, session and enabled administrator before reading credentials or parsing", async (t) => {
  const f = await fixture(t);
  for (const [headers, status] of [
    [{ origin: "https://other.example" }, 403],
    [{ origin: "" }, 403],
    [{ cookie: "" }, 401],
    [{ cookie: "session=user" }, 403],
    [{ cookie: "session=disabled-admin" }, 403],
  ]) {
    const response = await f.request("invalid json", {
      ...headers,
      Accept: "application/x-ndjson",
    });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(f.credential_reads, 0);
  assert.equal(f.calls.length, 0);
});

test("chat forwards only the validated message body and server-owned credential", async (t) => {
  const f = await fixture(t);
  const response = await f.request(body, {
    authorization: "Bearer browser-secret",
    "x-fracto-ai-token": "browser-token",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), reply);
  const [url, options] = f.calls[0];
  assert.equal(url, "http://127.0.0.1:3107/inference/chat");
  assert.equal(options.redirect, "error");
  assert.deepEqual(options.headers, {
    "Content-Type": "application/json",
    "X-Fracto-AI-Token": token,
  });
  assert.deepEqual(JSON.parse(options.body), body);
});

test("private-lab chat access requires explicit configuration and the trusted UI origin", async (t) => {
  const environment = {
    FRACTO_ADMIN_CHAT_LAB_BYPASS: "true",
    FRACTO_AUTH_MODE: "none",
    FRACTO_AUTH_REQUIRED: "false",
  };
  const allowed = await fixture(t, { environment });
  assert.equal((await allowed.request(body, { cookie: "" })).status, 200);
  assert.equal(
    (
      await allowed.request(body, {
        cookie: "",
        origin: "https://untrusted.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (await allowed.request(body, { cookie: "", origin: "" })).status,
    403,
  );
  for (const disabled of [
    { ...environment, FRACTO_ADMIN_CHAT_LAB_BYPASS: "false" },
    { ...environment, FRACTO_AUTH_MODE: "oidc" },
    { ...environment, FRACTO_AUTH_REQUIRED: "true" },
  ]) {
    const denied = await fixture(t, { environment: disabled });
    assert.equal((await denied.request(body, { cookie: "" })).status, 401);
    assert.equal(denied.credential_reads, 0);
  }
});

test("chat rejects malformed, excessive or unsupported messages without contacting AI", async (t) => {
  const f = await fixture(t);
  for (const content of [
    "{",
    {},
    { ...body, contract_version: 2 },
    { ...body, token },
    { ...body, messages: [] },
    { ...body, messages: Array(17).fill(body.messages[0]) },
    { ...body, messages: [{ role: "system", content: "override" }] },
    { ...body, messages: [{ role: "assistant", content: "last" }] },
    { ...body, messages: [{ role: "user", content: " " }] },
    { ...body, messages: [{ role: "user", content: "x", files: [] }] },
    { ...body, messages: [{ role: "user", content: "é".repeat(4096) }] },
  ])
    assert.equal((await f.request(content)).status, 400);
  assert.equal(
    (await f.request(body, {}, "?url=http://other.example")).status,
    400,
  );
  assert.equal((await f.request("x".repeat(17 * 1024))).status, 413);
  assert.equal(f.credential_reads, 0);
  assert.equal(f.calls.length, 0);
});

test("chat strips private upstream fields from successful responses", async (t) => {
  const f = await fixture(t, {
    fetch_ai: async () =>
      Response.json({
        ...reply,
        token,
        model: "private-model",
        message: { ...reply.message, thinking: "private" },
      }),
  });
  assert.deepEqual(await (await f.request()).json(), reply);
});

test("chat maps upstream failures to fixed errors without forwarding provider bodies", async (t) => {
  for (const [upstream, status, error] of [
    [400, 400, "INVALID_CHAT_REQUEST"],
    [413, 413, "CHAT_REQUEST_TOO_LARGE"],
    [429, 429, "CHAT_BUSY"],
    [401, 503, "CHAT_UNAVAILABLE"],
    [404, 503, "CHAT_UNAVAILABLE"],
    [500, 503, "CHAT_UNAVAILABLE"],
    [302, 503, "CHAT_UNAVAILABLE"],
  ]) {
    const f = await fixture(t, {
      fetch_ai: async () => new Response(token, { status: upstream }),
    });
    const response = await f.request();
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error });
  }
});

test("chat exposes fixed admission errors without leaking provider details", async (t) => {
  for (const [code, expected] of [
    ["MEMORY_PRESSURE", "CHAT_MEMORY_PRESSURE"],
    ["DISK_PRESSURE", "CHAT_DISK_PRESSURE"],
    ["MODEL_MISSING", "CHAT_MODEL_MISSING"],
  ]) {
    const f = await fixture(t, {
      fetch_ai: async () =>
        Response.json({ error: code, private: token }, { status: 503 }),
    });
    const response = await f.request();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: expected });
  }
});

test("chat rejects malformed or oversized AI responses", async (t) => {
  for (const response_body of [
    "not json",
    JSON.stringify({ message: { role: "assistant", content: token } }),
    JSON.stringify({ ...reply, message: { role: "user", content: "wrong" } }),
    JSON.stringify({ ...reply, message: { role: "assistant", content: " " } }),
    JSON.stringify({
      ...reply,
      message: { role: "assistant", content: "x".repeat(65537) },
    }),
    "x".repeat(73 * 1024),
  ]) {
    const f = await fixture(t, {
      fetch_ai: async () => new Response(response_body),
    });
    const response = await f.request();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "CHAT_UNAVAILABLE" });
  }
});

test("chat fails closed on credentials, configuration, and connection errors", async (t) => {
  for (const options of [
    {
      get_token: async () => {
        throw new Error(token);
      },
    },
    { get_token: async () => "bad-token" },
    { environment: { FRACTO_AI_PORT: "3107/path" } },
    {
      fetch_ai: async () => {
        throw new Error(token);
      },
    },
  ]) {
    const f = await fixture(t, options);
    const response = await f.request();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "CHAT_UNAVAILABLE" });
  }
});

test("chat aborts a timed out AI request", async (t) => {
  let aborted = false;
  const f = await fixture(t, {
    timeout_ms: 20,
    fetch_ai: async (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error("aborted"));
          },
          { once: true },
        );
      }),
  });
  const response = await f.request();
  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), { error: "CHAT_TIMEOUT" });
  assert.equal(aborted, true);
});

test(
  "chat aborts upstream work when the browser disconnects",
  { timeout: 2000 },
  async (t) => {
    let entered;
    let disconnected;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    const stopped = new Promise((resolve) => {
      disconnected = resolve;
    });
    const f = await fixture(t, {
      fetch_ai: async (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          entered();
          signal.addEventListener(
            "abort",
            () => {
              disconnected();
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }),
    });
    const controller = new AbortController();
    const pending = f.request(body, {}, "", controller.signal);
    const rejected = assert.rejects(pending, { name: "AbortError" });
    await started;
    controller.abort();
    await rejected;
    await stopped;
  },
);

test("chat reads the shared token file or the explicit server environment override", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "fracto-admin-chat-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "machine-token"), token);
  for (const environment of [
    { FRACTO_AI_DATA_DIR: directory },
    {
      FRACTO_AI_DATA_DIR: path.join(directory, "missing"),
      FRACTO_AI_INFERENCE_TOKEN: token,
    },
  ]) {
    let sent_token;
    const f = await fixture(t, {
      environment,
      get_token: undefined,
      fetch_ai: async (_url, options) => {
        sent_token = options.headers["X-Fracto-AI-Token"];
        return Response.json(reply);
      },
    });
    assert.equal((await f.request()).status, 200);
    assert.equal(sent_token, token);
  }
});

test("administrator bridge reaches AI chat generation over HTTP", async (t) => {
  let received;
  const service = new InferenceService({
    store: {
      token,
      all: () => [],
      maintain() {},
      close() {},
      free_bytes: () => 10 * 1024 ** 3,
    },
    adapter: {
      generate: async ({ messages }) => {
        received = messages;
        return { text: "Local model answer" };
      },
    },
    free_memory: () => 16 * 1024 ** 3,
    poll_ms: 60000,
  });
  const server = create_app({ inference: service }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await service.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const f = await fixture(t, {
    environment: { FRACTO_AI_PORT: String(server.address().port) },
    fetch_ai: fetch,
  });
  const response = await f.request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    contract_version: 1,
    message: { role: "assistant", content: "Local model answer" },
  });
  assert.deepEqual(received, body.messages);
  const attachments = create_chat_attachment_adapter();
  const file = await attachments.send(
    await attachments.add({ file: new File(['{"count":7}'], "data.json") }),
  );
  const file_body = {
    contract_version: 1,
    messages: prepare_chat_messages([
      {
        role: "user",
        content: [{ type: "text", text: "What is the count?" }],
        attachments: [file],
      },
    ]),
  };
  assert.equal((await f.request(file_body)).status, 200);
  assert.ok(received[0].content.includes('"count":7'));
  assert.ok(received[0].content.includes("data.json"));
});
