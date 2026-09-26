import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const script_path = fileURLToPath(new URL("../scripts/bootstrap_auth_admin.js", import.meta.url));

const run_installer = (port, input) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [script_path], {
    env: {
      ...process.env,
      FRACTO_DATA_PORT: `${port}`,
      FRACTO_BOOTSTRAP_ADMIN_CONFIRM: "must-not-be-used-from-env",
      FRACTO_BOOTSTRAP_ADMIN_SUBJECT: "must-not-be-used-from-env",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("close", (code) => resolve({ code, stdout, stderr }));
  if (input === undefined) child.stdin.end();
  else child.stdin.end(input);
});

test("bootstrap installer reads identity and confirmation from stdin only", async (t) => {
  let request_body;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    request_body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ user: { id: 4, email: request_body.email } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const secret_input = {
    confirmation: "private-one-time-value",
    provider: "google",
    provider_subject: "private-provider-subject",
    email: "admin@example.test",
    display_name: "Initial Admin",
  };

  const result = await run_installer(server.address().port, JSON.stringify(secret_input));

  assert.equal(result.code, 0);
  assert.deepEqual(request_body, secret_input);
  assert.match(result.stdout, /Administrator bootstrap succeeded/);
  for (const value of Object.values(secret_input)) {
    assert.equal(result.stdout.includes(value), false);
    assert.equal(result.stderr.includes(value), false);
  }
  assert.equal(request_body.confirmation, "private-one-time-value");
  assert.equal(request_body.provider_subject, "private-provider-subject");
});

test("bootstrap installer rejects missing protected input", async () => {
  const result = await run_installer(1, undefined);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Bootstrap input must be valid JSON/);
});
