import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import Decimal from "decimal.js";
import {
  OrbitalDataStore,
  open_orbital_database,
} from "../servers/fracto-data-server/handlers/orbital_data_store.js";
import { orbital_closure_error } from "../sdk/orbitals/FractoOrbitalIdentity.js";
import { validate_landing_families } from "../sdk/orbitals/FractoOrbitalDiscovery.js";
import { discover_orbital_batch } from "../sdk/orbitals/FractoOrbitalDiscovery.js";
import {
  positive_id,
  discovery_request,
} from "../servers/fracto-data-server/handlers/orbital_data_contract.js";

const schema = `fracto_orbital_verify_${randomBytes(6).toString("hex")}`;
let fixture;
const start_fixture = async () => {
  const child = fork(
    fileURLToPath(
      new URL(
        "../servers/fracto-data-server/tests/orbital_data_fixture_server.js",
        import.meta.url,
      ),
    ),
    [],
    {
      execArgv: [],
      env: { ...process.env, ORBITAL_VERIFY_SCHEMA: schema },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  let ready;
  try {
    ready = await Promise.race([
      once(child, "message").then(([message]) => message),
      once(child, "exit").then(() => {
        throw Error("verification_service_exited");
      }),
      pause(10000, undefined, { ref: false }).then(() => {
        throw Error("verification_service_timeout");
      }),
    ]);
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
  return { child, url: `http://127.0.0.1:${ready.port}/orbital-data` };
};
const stop_fixture = async () => {
  if (!fixture) return;
  const child = fixture.child;
  fixture = null;
  const exit = once(child, "exit");
  child.kill("SIGTERM");
  await exit;
};
const request = async (path, body, expected = 200) => {
  const response = await fetch(
    `${fixture.url}${path}`,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(result)}`);
  return result.result;
};
const finish = async (id) => {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const run = await request(`/discovery-jobs/${id}`);
    if (!["queued", "running"].includes(run.status)) return run;
    await pause(150);
  }
  throw Error("verification_job_timeout");
};

/** Opt-in: read one live source row, write only a newly created disposable schema. */
const verify = async () => {
  const source_id = positive_id(process.argv[2] || "55");
  const source_store = new OrbitalDataStore();
  const source = await source_store.source(source_id);
  const admin = await open_orbital_database();
  let created = false;
  try {
    // Identifiers are generated here and never accepted from command-line input.
    assert.match(schema, /^fracto_orbital_verify_[a-f0-9]{12}$/);
    await admin.query(`CREATE DATABASE \`${schema}\``);
    created = true;
    await admin.changeUser({ database: schema });
    let migration = (
      await readFile(
        process.env.ORBITAL_VERIFY_MIGRATION ||
          new URL(
            "../database/migrations/007_orbital-progressions.sql",
            import.meta.url,
          ),
        "utf8",
      )
    ).replace(/^--.*$/gm, "");
    migration +=
      "\n" +
      (
        await readFile(
          process.env.ORBITAL_VERIFY_SOURCE_MIGRATION ||
            new URL(
              "../database/migrations/008_orbital-bailiwick-source.sql",
              import.meta.url,
            ),
          "utf8",
        )
      ).replace(/^--.*$/gm, "");
    migration +=
      "\n" +
      (
        await readFile(
          new URL(
            "../database/migrations/009_orbital-survey-metadata.sql",
            import.meta.url,
          ),
          "utf8",
        )
      ).replace(/^--.*$/gm, "");
    migration +=
      "\n" +
      (
        await readFile(
          new URL(
            "../database/migrations/010_orbital-resume-checkpoints.sql",
            import.meta.url,
          ),
          "utf8",
        )
      ).replace(/^--.*$/gm, "");
    migration +=
      "\n" +
      (
        await readFile(
          new URL(
            "../database/migrations/016_orbital-lifecycle-state.sql",
            import.meta.url,
          ),
          "utf8",
        )
      ).replace(/^\s*--.*$/gm, "");
    for (const statement of migration.split(";").filter((sql) => sql.trim()))
      await admin.query(statement);
    // A second application tests safe recovery/replay against the disposable schema.
    for (const statement of migration.split(";").filter((sql) => sql.trim()))
      await admin.query(statement);
    const settings = {
      max_period: 4,
      grid_size: 31,
      max_angle_period: 4,
      max_families: 16,
      catalog_max_denominator: 0,
    };
    const open_target = async () => {
      const db = await open_orbital_database();
      await db.changeUser({ database: schema });
      return db;
    };
    const target_store = new OrbitalDataStore({ open: open_target });
    const rollback_request = discovery_request({
      free_bailiwick_id: source_id,
      settings,
      request_key: "rollback-check",
    });
    const rollback_run = await target_store.create_run(
      source,
      rollback_request,
    );
    const candidate = discover_orbital_batch({
      parameter: source.parameter,
      period: 1,
      seeds: [{ x: 1.5, y: 0 }],
      settings: rollback_request.settings,
    }).candidates[0];
    assert.ok(candidate);
    const failing_store = new OrbitalDataStore({
      open: async () => {
        const db = await open_target(),
          execute = db.execute.bind(db);
        db.execute = (sql, values) => {
          if (sql.startsWith("INSERT INTO orbital_progression_points"))
            throw Error("injected_point_write_failure");
          return execute(sql, values);
        };
        return db;
      },
    });
    await assert.rejects(
      failing_store.save_orbital(rollback_run.id, source, candidate),
      /injected_point_write_failure/,
    );
    for (const table of [
      "orbital_progressions",
      "orbital_progression_points",
      "orbital_discovery_results",
    ]) {
      const [[row]] = await admin.query(`SELECT COUNT(*) AS n FROM ${table}`);
      assert.equal(
        Number(row.n),
        0,
        "a failed point write must roll back the orbital header too",
      );
    }
    await target_store.cancel(rollback_run.id);
    fixture = await start_fixture();
    const expired = await target_store.create_run(source, {
      ...rollback_request,
      request_key: "expired-lease-check",
    });
    await admin.execute(
      "UPDATE orbital_discovery_runs SET lease_expires_at=DATE_SUB(NOW(3),INTERVAL 1 SECOND) WHERE id=?",
      [expired.id],
    );
    assert.equal(
      (await request(`/discovery-jobs/${expired.id}`)).status,
      "interrupted",
    );
    const body = {
      free_bailiwick_id: source_id,
      settings,
      request_key: "single-core-first",
    };
    const initial = await request("/discovery-jobs", body, 202);
    const run = await finish(initial.id);
    assert.ok(
      ["completed", "partial"].includes(run.status),
      JSON.stringify(run),
    );
    assert.equal(
      run.error_code,
      null,
      "all calculation and storage stages must finish",
    );
    assert.deepEqual(run.focal_point, {
      re: source.parameter.x,
      im: source.parameter.y,
    });
    assert.ok(
      run.results.length >= 2,
      "must retain distinct cycles at this focal point",
    );
    assert.equal(
      Object.values(run.progress.ray_outcomes).reduce((a, b) => a + b, 0),
      run.results.length,
    );
    const progressions = [];
    let ratio_count = 0;
    for (const result of run.results) {
      const orbital = await request(`/${result.orbital_id}`);
      assert.equal(orbital.free_bailiwick_id, source_id);
      assert.equal(orbital.points.length, orbital.period);
      assert.deepEqual(
        orbital.points.map((p) => p.point_index),
        Array.from({ length: orbital.period }, (_, i) => i),
      );
      const error = orbital_closure_error(
        source.parameter,
        orbital.points.map((p) => p.point),
      );
      assert.ok(new Decimal(error).lte(orbital.closure_tolerance));
      const ratios = orbital.points.flatMap((p) =>
        p.landing_ratios.map((r) => ({ ...r, point_index: p.point_index })),
      );
      validate_landing_families(ratios, orbital.period);
      ratio_count += ratios.length;
      progressions.push(orbital);
    }
    assert.ok(
      ratio_count > 0,
      "must store and retrieve validated landing ratios",
    );
    assert.ok(
      new Set(progressions.map((o) => o.period)).size < progressions.length,
      "same-period cycles need separate IDs",
    );
    const query = `?focal_re=${encodeURIComponent(source.parameter.x)}&focal_im=${encodeURIComponent(source.parameter.y)}`;
    assert.equal((await request(query)).length, run.results.length);
    assert.equal((await request("/discovery-jobs", body, 202)).id, run.id);
    await request(
      "/discovery-jobs",
      { ...body, settings: { ...settings, max_period: 1 } },
      409,
    );
    const repeat = await finish(
      (
        await request(
          "/discovery-jobs",
          { ...body, request_key: "single-core-repeat" },
          202,
        )
      ).id,
    );
    assert.equal(repeat.error_code, null);
    assert.deepEqual(
      repeat.results.map((r) => r.orbital_id),
      run.results.map((r) => r.orbital_id),
    );
    assert.ok(repeat.results.every((r) => r.disposition === "reused"));
    const cancel = await request(
      "/discovery-jobs",
      { ...body, request_key: "single-core-cancel" },
      202,
    );
    const cancelled = await request(`/discovery-jobs/${cancel.id}/cancel`, {});
    assert.equal(cancelled.status, "cancelled");
    await pause(300);
    assert.equal(
      (await request(`/discovery-jobs/${cancel.id}`)).results.length,
      cancelled.results.length,
    );
    await stop_fixture();
    fixture = await start_fixture();
    assert.equal(
      (await request(`/discovery-jobs/${run.id}`)).status,
      run.status,
    );
    for (const orbital of progressions)
      assert.deepEqual(await request(`/${orbital.orbital_id}`), {
        ...orbital,
        discovery_metadata: {
          ...orbital.discovery_metadata,
          run_id: repeat.id,
        },
      });
    assert.deepEqual(
      await source_store.source(source_id),
      source,
      "source record must remain unchanged",
    );
    const report = {
      verified_at: new Date().toISOString(),
      source_bailiwick_id: source_id,
      focal_point: run.focal_point,
      source_pattern: source.pattern,
      settings: run.settings,
      outcome: run.status,
      orbital_count: run.results.length,
      landing_ratio_count: ratio_count,
      same_period_cycles:
        progressions.length - new Set(progressions.map((o) => o.period)).size,
      ray_outcomes: run.progress.ray_outcomes,
      repeat_reused_all_ids: true,
      cancellation_verified: true,
      process_restart_verified: true,
      migration_replay_verified: true,
      source_unchanged: true,
      transaction_rollback_verified: true,
      expired_lease_verified: true,
      storage: "disposable MySQL schema; live source read-only; no backfill",
    };
    await writeFile(
      new URL("../logs/orbital_discovery_verification.json", import.meta.url),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await stop_fixture();
    if (created) {
      await admin.query(`DROP DATABASE \`${schema}\``);
    }
    await admin.end();
    await source_store.close();
  }
};
verify().catch((error) => {
  console.error(
    "Orbital verification failed:",
    error.code === "ERR_ASSERTION"
      ? error.message
      : error.code || error.message,
  );
  process.exitCode = 1;
});
