import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { cpus, platform, arch } from "node:os";
import { setTimeout as pause } from "node:timers/promises";
import {
  open_orbital_database,
  create_orbital_database_pool,
} from "../servers/fracto-data-server/handlers/orbital_data_database.js";
import { OrbitalDataStore } from "../servers/fracto-data-server/handlers/orbital_data_store.js";
import { OrbitalDiscoveryJobs } from "../servers/fracto-data-server/handlers/orbital_data_jobs.js";
import { WorkerTaskPool } from "../servers/fracto-data-server/handlers/worker_task_pool.js";
import { discovery_request } from "../servers/fracto-data-server/handlers/orbital_data_contract.js";
import {
  load_job_catalog,
  job_catalog_profile,
} from "../servers/fracto-data-server/handlers/orbital_catalog_jobs.js";
import { discover_catalog_orbitals } from "../sdk/orbitals/FractoCatalogOrbitalDiscovery.js";
import { same_orbital_cycle } from "../sdk/orbitals/FractoOrbitalIdentity.js";
import { validate_landing_families } from "../sdk/orbitals/FractoOrbitalDiscovery.js";

// Application sources are read only. Every job, cancellation and cache write
// runs in a uniquely owned disposable schema, removed even after assertions fail.
const args = process.argv.slice(2),
  options = {};
for (let index = 0; index < args.length; index += 2) {
  assert.ok(
    ["--max-denominator", "--grid-size", "--source-id", "--output"].includes(
      args[index],
    ),
    "Unknown benchmark option",
  );
  assert.ok(args[index + 1], "Missing benchmark option value");
  options[args[index].slice(2)] = args[index + 1];
}
const maximum = Number(options["max-denominator"] || 31);
const grid_size = Number(options["grid-size"] || 31);
const source_id = options["source-id"] || "65";
const output = resolve(options.output || "logs/orbital_catalog_benchmark.json");
const catalog_start = performance.now();
const catalog = await load_job_catalog(maximum);
const catalog_load_ms = performance.now() - catalog_start;
const schema = `fracto_catalog_bench_${randomUUID().replaceAll("-", "")}`;
assert.match(schema, /^fracto_catalog_bench_[a-f0-9]{32}$/);
const admin = await open_orbital_database(),
  application = new OrbitalDataStore();
let database,
  pool,
  jobs,
  created = false;
const report = {
  version: 1,
  started_at: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    workers: 1,
  },
  settings: { max_denominator: maximum, grid_size, source_id, catalog_load_ms },
  limitations: [
    "Single measurements on a development machine; cold includes worker startup and cancellation/resume overhead.",
    "The survey grid and denominator bound are explicit bounded diagnostics, not a completeness proof.",
    "Warm timing includes the unchanged survey and SQL publication; zero catalog worker tasks verifies reuse.",
  ],
  cases: [],
};
const event = (value) => console.log(JSON.stringify(value));
const settle = async () => {
  const deadline = Date.now() + 600000;
  let last = 0;
  while (jobs.active.size && Date.now() < deadline) {
    if (Date.now() - last > 10000) {
      event({
        phase: "waiting",
        jobs: [...jobs.active.values()].map(({ progress }) => ({
          phase: progress.phase,
          processed: progress.catalog_processed,
          total: progress.catalog_total,
          orbitals: progress.orbital_count,
        })),
      });
      last = Date.now();
    }
    await pause(20);
  }
  assert.equal(
    jobs.active.size,
    0,
    "Benchmark job exceeded ten-minute deadline",
  );
};
try {
  const stored_source = await application.source(source_id);
  const cases = [
    { id: "1", name: "unit_circle", parameter: { x: "0", y: "0" }, pattern: 1 },
    { id: "2", name: "basilica", parameter: { x: "-1", y: "0" }, pattern: 2 },
    {
      id: "3",
      name: `stored_core_${source_id}`,
      parameter: stored_source.parameter,
      pattern: stored_source.pattern,
    },
  ];
  await admin.query(`CREATE DATABASE \`${schema}\``);
  created = true;
  await admin.query(`USE \`${schema}\``);
  for (const name of [
    "007_orbital-progressions.sql",
    "008_orbital-bailiwick-source.sql",
    "009_orbital-survey-metadata.sql",
    "010_orbital-resume-checkpoints.sql",
    "012_orbital-ray-paths.sql",
    "013_orbital-family-investigations.sql",
    "014_orbital-family-job-owners.sql",
    "015_orbital-ray-cache-chunks.sql",
    "016_orbital-lifecycle-state.sql",
  ]) {
    const sql = await readFile(
      new URL(`../database/migrations/${name}`, import.meta.url),
      "utf8",
    );
    for (const statement of sql
      .replace(/^\s*--.*$/gm, "")
      .split(";")
      .filter((value) => value.trim()))
      await admin.query(statement);
  }
  await admin.query(
    "CREATE TABLE free_bailiwicks (id BIGINT UNSIGNED PRIMARY KEY,core_point JSON,pattern INT)",
  );
  database = await create_orbital_database_pool(schema);
  const store = new OrbitalDataStore({ open: () => database.getConnection() });
  pool = new WorkerTaskPool({ size: 1, task_timeout_ms: 120000 });
  const calls = [],
    original_task = pool.run.bind(pool);
  pool.run = async (name, payload, ...rest) => {
    const start = performance.now();
    const call = { name, family_key: payload.family?.key };
    calls.push(call);
    try {
      return await original_task(name, payload, ...rest);
    } finally {
      call.ms = performance.now() - start;
    }
  };
  const manager = () =>
    new OrbitalDiscoveryJobs({
      store,
      pool,
      task_timeout_ms: 120000,
      run_timeout_ms: 600000,
    });
  const describe = async (run) => {
    assert.ok(["completed", "partial"].includes(run.status), run.error_code);
    assert.equal(run.progress.all_orbitals_discovered, false);
    const members = await store.latest_survey(run.focal_point);
    assert.equal(members.run_id, run.id);
    assert.deepEqual(members.coverage, run.progress.catalog_coverage);
    const orbitals = [];
    for (let start = 0; start < members.result.length; start += 4)
      orbitals.push(
        ...(await Promise.all(
          members.result
            .slice(start, start + 4)
            .map((header) => store.get(header.id)),
        )),
      );
    for (const orbital of orbitals)
      validate_landing_families(
        orbital.points.flatMap((point) =>
          point.landing_ratios.map((ratio) => ({
            ...ratio,
            point_index: point.point_index,
          })),
        ),
        orbital.period,
        { max_angle_period: 4096 },
      );
    return { members, orbitals };
  };
  for (const fixture of cases) {
    event({
      phase: "case_start",
      name: fixture.name,
      parameter: fixture.parameter,
    });
    await admin.execute("INSERT INTO free_bailiwicks VALUES (?,?,?)", [
      fixture.id,
      JSON.stringify(fixture.parameter),
      fixture.pattern,
    ]);
    const request = discovery_request({
      free_bailiwick_id: fixture.id,
      request_key: `cold-${fixture.name}`,
      settings: {
        grid_size,
        catalog_max_denominator: maximum,
        discovery_strategy: "survey-catalog-full-rays-v1",
      },
    });
    const stop_after = Math.min(2, catalog.family_count);
    let cancelled = false;
    const original_checkpoint = store.save_checkpoint.bind(store);
    store.save_checkpoint = async (id, checkpoint, token) => {
      await original_checkpoint(id, checkpoint, token);
      if (
        !cancelled &&
        checkpoint.stage === "catalog" &&
        checkpoint.catalog?.family_index === stop_after
      ) {
        cancelled = true;
        await jobs.cancel(id);
      }
    };
    const start = performance.now(),
      task_start = calls.length;
    jobs = manager();
    const started = await jobs.start(request);
    await settle();
    assert.equal((await store.get_run(started.id)).status, "cancelled");
    const interrupted_ms = performance.now() - start;
    store.save_checkpoint = original_checkpoint;
    const resume_start = performance.now();
    jobs = manager();
    await jobs.resume(started.id);
    await settle();
    const cold_ms = performance.now() - start,
      resume_ms = performance.now() - resume_start;
    const cold = await store.get_run(started.id),
      cold_data = await describe(cold);
    const cold_calls = calls.slice(task_start);
    const family_calls = cold_calls.filter(
      (call) => call.name === "orbital_catalog_family",
    );
    assert.equal(family_calls.length, catalog.family_count);
    assert.equal(
      new Set(family_calls.map((call) => call.family_key)).size,
      catalog.family_count,
      "Resume must not repeat completed families",
    );
    const warm_start = performance.now(),
      warm_task_start = calls.length;
    jobs = manager();
    const warmed = await jobs.start({
      ...request,
      request_key: `warm-${fixture.name}`,
    });
    await settle();
    const warm_ms = performance.now() - warm_start;
    const warm = await store.get_run(warmed.id),
      warm_data = await describe(warm);
    assert.equal(
      calls
        .slice(warm_task_start)
        .filter((call) => call.name === "orbital_catalog_family").length,
      0,
    );
    assert.equal(warm.progress.catalog_cache_hits, catalog.family_count);
    assert.deepEqual(
      warm_data.members.result.map((row) => row.id),
      cold_data.members.result.map((row) => row.id),
    );
    assert.equal(
      warm.progress.catalog_accepted,
      cold.progress.catalog_accepted,
    );
    assert.equal(
      warm.progress.catalog_unresolved,
      cold.progress.catalog_unresolved,
    );
    const reference_start = performance.now();
    const reference = await discover_catalog_orbitals(fixture.parameter, {
      ...job_catalog_profile(request.settings),
      catalog,
      retain_geometry: false,
    });
    const reference_ms = performance.now() - reference_start;
    assert.equal(reference.families.length, cold.progress.catalog_accepted);
    assert.equal(reference.unresolved.length, cold.progress.catalog_unresolved);
    for (const candidate of reference.candidates)
      assert.ok(
        cold_data.orbitals.some((orbital) =>
          same_orbital_cycle(
            candidate.points,
            orbital.points.map((point) => point.point),
            orbital.identity_tolerance || "1e-7",
          ),
        ),
        "SDK discovery must be present in job results",
      );
    const source = await store.source(fixture.id);
    const [storage] = await admin.execute(
      `SELECT COUNT(*) AS entries,COALESCE(SUM(OCTET_LENGTH(p.paths)),0) AS bytes
      FROM orbital_ray_paths p JOIN orbital_progressions o ON o.id=p.orbital_id WHERE o.focal_key=?`,
      [source.focal_key],
    );
    const timings = {
      cold_resumed_ms: cold_ms,
      before_cancel_ms: interrupted_ms,
      resume_ms,
      warm_ms,
      speedup: cold_ms / warm_ms,
      catalog_worker_ms: family_calls.reduce((sum, call) => sum + call.ms, 0),
      sdk_reference_ms: reference_ms,
    };
    const result = {
      name: fixture.name,
      parameter: fixture.parameter,
      pattern: fixture.pattern,
      settings: request.settings,
      timings,
      catalog_worker_tasks: family_calls.length,
      warm_catalog_worker_tasks: 0,
      orbitals: cold_data.orbitals.length,
      periods: cold_data.orbitals.map((orbital) => orbital.period),
      ratios: cold_data.orbitals.reduce(
        (sum, orbital) =>
          sum +
          orbital.points.reduce(
            (n, point) => n + point.landing_ratios.length,
            0,
          ),
        0,
      ),
      paths: {
        entries: Number(storage[0].entries),
        bytes: Number(storage[0].bytes),
      },
      coverage: warm.progress.catalog_coverage,
      verified: {
        resume_without_retracing: true,
        warm_without_catalog_tasks: true,
        sdk_parity: true,
        complete_landing_families: true,
        persisted_coverage: true,
        stable_ranked_membership: true,
      },
    };
    report.cases.push(result);
    event({
      phase: "case_complete",
      name: fixture.name,
      timings,
      orbitals: result.orbitals,
      validated: result.coverage.validated_families,
      unresolved: result.coverage.unresolved_families,
    });
  }
} finally {
  await application.close();
  if (jobs)
    for (const id of jobs.active.keys()) await jobs.cancel(id).catch(() => {});
  await pool?.close();
  if (jobs)
    await Promise.allSettled(
      [...jobs.active.values()].map((state) => state.completion),
    );
  await database?.end();
  if (created) {
    await admin.query(`DROP DATABASE \`${schema}\``);
    report.disposable_schema_removed = true;
  }
  await admin.end();
}
report.finished_at = new Date().toISOString();
report.peak_rss_bytes = process.resourceUsage().maxRSS * 1024;
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
event({
  phase: "complete",
  output,
  cases: report.cases.length,
  disposable_schema_removed: report.disposable_schema_removed,
});
