import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

/** Launch an owner-declared, isolated fixture executable; all operations use HTTP. */
export async function launch_service_fixture(entry, options = {}, test) {
  const token = randomBytes(24).toString("hex");
  const child = spawn(
    process.execPath,
    [entry instanceof URL ? fileURLToPath(entry) : entry, "--serve-fixture"],
    {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        FRACTO_TEST_FIXTURE_TOKEN: token,
        FRACTO_TEST_FIXTURE_OPTIONS: JSON.stringify(options),
      },
    },
  );
  const stop_child = () => child.kill();
  process.once("exit", stop_child);
  child.once("exit", () => process.removeListener("exit", stop_child));
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-8192);
  });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Fixture startup timeout: " + stderr));
    }, 15000);
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      if (line.startsWith("@@fixture ")) {
        clearTimeout(timer);
        resolve(JSON.parse(line.slice(10)).url);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Fixture exited ${code}: ${stderr}`));
    });
  });
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  };
  test?.after(close);
  const request = async (operation, body = {}) => {
    const response = await fetch(base + "/__fixture/" + operation, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Fixture-Token": token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(data.error), {
        status: response.status,
        code: data.error,
      });
    return data;
  };
  const sync = (operation, body = {}) => {
    const code = `const r=await fetch(process.argv[1],{method:"POST",headers:{"Content-Type":"application/json","X-Fixture-Token":process.argv[2]},body:process.argv[3],signal:AbortSignal.timeout(15000)});process.stdout.write(JSON.stringify({status:r.status,data:await r.json()}));`;
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          code,
          base + "/__fixture/" + operation,
          token,
          JSON.stringify(body),
        ],
        { encoding: "utf8", windowsHide: true, timeout: 20000 },
      ),
    );
    if (result.status >= 400)
      throw Object.assign(new Error(result.data.error), {
        status: result.status,
        code: result.data.error,
      });
    return result.data;
  };
  return { base, close, request, sync };
}

/** Owner fixtures call this only behind their explicit CLI flag, never in production. */
export async function serve_fixture(app, express, handlers = {}) {
  if (
    !process.argv.includes("--serve-fixture") ||
    !process.env.FRACTO_TEST_FIXTURE_TOKEN
  )
    throw new Error("Fixture executable requires explicit test invocation");
  app.post(
    "/__fixture/:operation",
    (req, res, next) =>
      req.get("X-Fixture-Token") === process.env.FRACTO_TEST_FIXTURE_TOKEN
        ? next()
        : res.sendStatus(403),
    express.json({ limit: "8mb" }),
    async (req, res) => {
      const operation = handlers[req.params.operation];
      if (!operation)
        return res.status(404).json({ error: "unknown_fixture_operation" });
      try {
        res.json((await operation(req.body)) ?? {});
      } catch (error) {
        res
          .status(error.status || 400)
          .json({ error: error.code || error.message });
      }
    },
  );
  const server = app.listen(0, "127.0.0.1", () =>
    console.log(
      "@@fixture " +
        JSON.stringify({ url: `http://127.0.0.1:${server.address().port}` }),
    ),
  );
  process.on("SIGTERM", () => {
    server.closeAllConnections();
    server.close(() => process.exit(0));
  });
  return server;
}
