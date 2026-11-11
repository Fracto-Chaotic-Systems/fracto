import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { fork } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import {
  OrbitalDataStore,
  open_orbital_database,
} from "../servers/fracto-data-server/handlers/orbital_data_store.js";
import { decode_checkpoint } from "../servers/fracto-data-server/handlers/orbital_data_checkpoint.js";
import { calculate_orbital_survey_discovery } from "../servers/fracto-data-server/handlers/orbital_data_scan.js";
import { discovery_request } from "../servers/fracto-data-server/handlers/orbital_data_contract.js";
import {
  calculate_orbital_landing_ratios,
  validate_landing_families,
} from "../sdk/orbitals/FractoOrbitalDiscovery.js";
import { same_orbital_cycle } from "../sdk/orbitals/FractoOrbitalIdentity.js";

// One live core point is read; all writes and crashes use a disposable schema/service.
const schema = `fracto_orbital_verify_${randomBytes(6).toString("hex")}`;
const source_store = new OrbitalDataStore(),
  admin = await open_orbital_database();
let fixture,
  created = false;
const events = () => fixture.events;
const start = async () => {
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
      env: {
        ...process.env,
        ORBITAL_VERIFY_SCHEMA: schema,
        ORBITAL_VERIFY_CHECKPOINT_DELAY_MS: "40",
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  const messages = [];
  child.on("message", (m) => messages.push(m));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  const deadline = Date.now() + 15000;
  while (!messages.some((m) => m.port) && Date.now() < deadline) {
    assert.equal(child.exitCode, null, "fixture must start");
    await pause(10);
  }
  const ready = messages.find((m) => m.port);
  assert.ok(ready, "fixture startup timeout");
  fixture = {
    child,
    events: messages,
    url: `http://127.0.0.1:${ready.port}/orbital-data`,
  };
};
const stop = async (signal = "SIGTERM") => {
  if (!fixture) return;
  const child = fixture.child;
  fixture = null;
  const exited = once(child, "exit");
  child.kill(signal);
  await exited;
};
const request = async (path, body, status = 200) => {
  const response = await fetch(
    fixture.url + path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  assert.ok(
    [status].flat().includes(response.status),
    `${response.status}: ${JSON.stringify(data)}`,
  );
  if (response.status === 409) {
    assert.equal(data.error, "bailiwick_busy");
    return null;
  }
  return data.result;
};
const wait_event = async (predicate) => {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const event = events().find(predicate);
    if (event) return event;
    await pause(5);
  }
  throw Error("checkpoint_event_timeout");
};
const checkpoint = async (id) => {
  const [[row]] = await admin.execute(
    "SELECT payload FROM orbital_discovery_checkpoints WHERE run_id=?",
    [id],
  );
  return decode_checkpoint(row.payload);
};
try {
  const source = await source_store.source("65");
  const settings = discovery_request({
    free_bailiwick_id: source.id,
    settings: {
      max_angle_period: 7,
      max_families: 18,
      catalog_max_denominator: 0,
    },
  }).settings;
  const baseline = await calculate_orbital_survey_discovery({
    parameter: source.parameter,
    settings,
  });
  assert.match(schema, /^fracto_orbital_verify_[a-f0-9]{12}$/);
  await admin.query(`CREATE DATABASE \`${schema}\``);
  created = true;
  await admin.changeUser({ database: schema });
  for (const file of [
    "007_orbital-progressions.sql",
    "008_orbital-bailiwick-source.sql",
    "009_orbital-survey-metadata.sql",
    "010_orbital-resume-checkpoints.sql",
    "016_orbital-lifecycle-state.sql",
  ]) {
    const sql = (
      await readFile(
        new URL(`../database/migrations/${file}`, import.meta.url),
        "utf8",
      )
    ).replace(/^--.*$/gm, "");
    for (const statement of sql.split(";").filter((s) => s.trim()))
      await admin.query(statement);
  }
  const body = {
    free_bailiwick_id: source.id,
    settings,
    request_key: "resume-cycle",
  };
  await start();
  const initial = await request("/discovery-jobs", body, 202);
  await request(
    "/discovery-jobs",
    {
      ...body,
      request_key: "competing",
      settings: { ...settings, max_families: 19 },
    },
    409,
  );
  await request(`/discovery-jobs/${initial.id}/resume`, {}, 409);
  // A different bailiwick can use the other worker concurrently.
  const independent = await request(
    "/discovery-jobs",
    { free_bailiwick_id: "55", request_key: "independent" },
    202,
  );
  await wait_event(
    (e) => e.event === "worker" && e.affinity.includes(independent.id),
  );
  await request(`/discovery-jobs/${independent.id}/cancel`, {});
  await wait_event(
    (e) => e.event === "checkpoint" && e.stage === "scan" && e.scan_count > 0,
  );
  const cancelled = await request(`/discovery-jobs/${initial.id}/cancel`, {});
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.resumable, true);
  const saved_scan = await checkpoint(initial.id);
  assert.ok(saved_scan.scan.tested_pixels.length > 0);
  const saved_count = saved_scan.scan.tested_pixels.length;
  await stop();
  await start();
  const resumed = await request("/discovery-jobs", body, 202);
  assert.equal(resumed.id, initial.id);
  assert.equal(resumed.resume_count, 1);
  const first_scan = await wait_event(
    (e) => e.event === "task" && e.name === "orbital_survey_scan",
  );
  assert.equal(first_scan.processed, saved_count);
  assert.ok(
    !events().some(
      (e) => e.event === "task" && e.name === "orbital_survey_rows",
    ),
  );
  await wait_event(
    (e) =>
      e.event === "checkpoint" &&
      e.stage === "rays" &&
      e.ray_index > 0 &&
      e.ray_count > 0,
  );
  const [[owner]] = await admin.execute(
    "SELECT execution_token FROM orbital_discovery_runs WHERE id=?",
    [initial.id],
  );
  await stop("SIGKILL");
  const saved_rays = await checkpoint(initial.id);
  assert.ok(
    saved_rays.ray_state.processed > 0 && saved_rays.ray_state.rays.length > 0,
  );
  const completed_ids = new Set(
    saved_rays.orbitals.slice(0, saved_rays.ray_index).map((o) => o.id),
  );
  await admin.execute(
    "UPDATE orbital_discovery_runs SET lease_expires_at=DATE_SUB(NOW(3),INTERVAL 1 SECOND) WHERE id=?",
    [initial.id],
  );
  await start();
  const interrupted = await request(`/discovery-jobs/${initial.id}`);
  assert.equal(interrupted.status, "interrupted");
  assert.equal(interrupted.resumable, true);
  const contenders = await Promise.all([
    request(`/discovery-jobs/${initial.id}/resume`, {}, [202, 409]),
    request(`/discovery-jobs/${initial.id}/resume`, {}, [202, 409]),
  ]);
  assert.equal(contenders.filter(Boolean).length, 1);
  const restarted = contenders.find(Boolean);
  assert.equal(restarted.id, initial.id);
  assert.equal(restarted.resume_count, 2);
  const first_ray = await wait_event(
    (e) => e.event === "task" && e.name === "orbital_landing_ratios",
  );
  assert.equal(
    first_ray.orbital_id,
    saved_rays.orbitals[saved_rays.ray_index].id,
  );
  assert.equal(first_ray.processed, saved_rays.ray_state.processed);
  const target = new OrbitalDataStore({
    open: async () => {
      const db = await open_orbital_database();
      await db.changeUser({ database: schema });
      return db;
    },
  });
  await assert.rejects(
    target.checkpoint(
      initial.id,
      "discovering",
      {},
      "running",
      null,
      owner.execution_token,
    ),
    (e) => e.code === "job_not_active",
  );
  await assert.rejects(
    target.save_checkpoint(initial.id, saved_rays, owner.execution_token),
    (e) => e.code === "job_not_active",
  );
  await assert.rejects(
    target.save_orbital(
      initial.id,
      source,
      baseline.candidates[0],
      owner.execution_token,
    ),
    (e) => e.code === "job_not_active",
  );
  await assert.rejects(
    target.save_rays(
      initial.id,
      saved_rays.orbitals[0],
      { status: "no_rays", ratios: [], metadata: {} },
      owner.execution_token,
    ),
    (e) => e.code === "job_not_active",
  );
  await assert.rejects(
    target.heartbeat(initial.id, owner.execution_token),
    (e) => e.code === "job_not_active",
  );
  let run = restarted;
  const deadline = Date.now() + 180000;
  while (["queued", "running"].includes(run.status) && Date.now() < deadline) {
    await pause(250);
    run = await request(`/discovery-jobs/${initial.id}`);
  }
  assert.equal(run.status, "completed", JSON.stringify(run));
  const assigned_workers = events().filter(
    (e) => e.event === "worker" && e.affinity.includes(initial.id),
  );
  assert.ok(assigned_workers.length > 1);
  assert.equal(
    new Set(assigned_workers.map((e) => e.thread_id)).size,
    1,
    "all batches in an execution use one physical worker",
  );
  assert.equal(run.error_code, null);
  assert.ok(
    !events().some(
      (e) =>
        e.event === "task" &&
        ["orbital_survey_rows", "orbital_survey_scan"].includes(e.name),
    ),
  );
  assert.ok(
    !events().some(
      (e) =>
        e.event === "task" &&
        e.name === "orbital_landing_ratios" &&
        completed_ids.has(e.orbital_id),
    ),
  );
  assert.equal(run.results.length, baseline.candidates.length);
  const listed = await request(
    `?${new URLSearchParams({ focal_re: source.parameter.x, focal_im: source.parameter.y, view: "survey" })}`,
  );
  let ratios = 0;
  for (const [rank, header] of listed.entries()) {
    // The ordinary request adapter returns only result; list order is still the public survey order.
    const orbital = await request(`/${header.id}`),
      expected = baseline.candidates[rank];
    assert.equal(
      header.discovery_metadata.discovery_count,
      expected.discovery_metadata.discovery_count,
    );
    assert.equal(header.discovery_metadata.rank, rank);
    assert.ok(
      Math.abs(
        header.discovery_metadata.confidence -
          expected.discovery_metadata.confidence,
      ) < 1e-14,
    );
    assert.ok(
      same_orbital_cycle(
        orbital.points.map((p) => p.point),
        expected.points,
        "1e-7",
      ),
    );
    const families = orbital.points.flatMap((p) =>
      p.landing_ratios.map((r) => ({ ...r, point_index: p.point_index })),
    );
    validate_landing_families(families, orbital.period);
    ratios += families.length;
  }
  const second_id = saved_rays.orbitals[saved_rays.ray_index].id;
  const second = await request(`/${second_id}`);
  const ray_baseline = await calculate_orbital_landing_ratios({
    parameter: source.parameter,
    orbital: {
      points: second.points.map((p) => p.point),
      period: second.period,
    },
    settings,
  });
  assert.equal(
    second.points.reduce((n, p) => n + p.landing_ratios.length, 0),
    ray_baseline.ratios.length,
  );
  assert.deepEqual(
    second.points
      .flatMap((p) =>
        p.landing_ratios.map(
          (r) => `${p.point_index}:${r.numerator}/${r.denominator}`,
        ),
      )
      .sort(),
    ray_baseline.ratios
      .map((r) => `${r.point_index}:${r.numerator}/${r.denominator}`)
      .sort(),
  );
  assert.deepEqual(await source_store.source(source.id), source);
  const final_checkpoint = await checkpoint(initial.id);
  assert.equal(final_checkpoint.stage, "done");
  const task_count = events().filter((e) => e.event === "task").length;
  await request(`/discovery-jobs/${initial.id}/resume`, {}, 202);
  assert.equal(
    events().filter((e) => e.event === "task").length,
    task_count,
    "completed work must not restart",
  );
  // Reproduce cancellation after the final durable save but before terminal publication.
  await admin.execute(
    "UPDATE orbital_discovery_runs SET status='cancelled',cancel_requested=1 WHERE id=?",
    [initial.id],
  );
  const finalized = await request(
    `/discovery-jobs/${initial.id}/resume`,
    {},
    202,
  );
  assert.equal(finalized.id, initial.id);
  let final = await request(`/discovery-jobs/${initial.id}`);
  while (["queued", "running"].includes(final.status)) {
    await pause(10);
    final = await request(`/discovery-jobs/${initial.id}`);
  }
  assert.equal(final.status, "completed");
  assert.equal(events().filter((e) => e.event === "task").length, task_count);
  const report = {
    verified_at: new Date().toISOString(),
    source_id: source.id,
    orbital_count: run.results.length,
    landing_ratios: ratios,
    cancelled_scan_resumed: true,
    process_crash_resumed: true,
    completed_orbitals_skipped: true,
    completed_ray_families_retained: true,
    stale_owner_fenced: true,
    concurrent_resume_single_owner: true,
    single_compute_worker_per_execution: true,
    different_settings_same_bailiwick_blocked: true,
    different_bailiwicks_concurrent: true,
    finalization_resume_without_recalculation: true,
    discovery_counts_and_rankings_match: true,
    source_unchanged: true,
    backfill: false,
    storage: "disposable schema",
  };
  await writeFile(
    new URL("../logs/orbital_resume_verification.json", import.meta.url),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await stop();
  if (created) {
    assert.match(schema, /^fracto_orbital_verify_[a-f0-9]{12}$/);
    await admin.query(`DROP DATABASE \`${schema}\``);
  }
  await admin.end();
  await source_store.close();
}
