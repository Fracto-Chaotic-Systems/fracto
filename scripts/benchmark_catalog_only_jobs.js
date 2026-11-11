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
  job_compact_profile,
  job_catalog_profile,
} from "../servers/fracto-data-server/handlers/orbital_catalog_jobs.js";
import { OrbitalRayPathStore } from "../servers/fracto-data-server/handlers/orbital_ray_paths.js";
import { decode_orbital_cache } from "../servers/fracto-data-server/handlers/orbital_ray_cache_codec.js";
import { discover_catalog_orbitals } from "../sdk/orbitals/FractoCatalogOrbitalDiscovery.js";
import {
  same_orbital_cycle,
  canonical_orbital,
} from "../sdk/orbitals/FractoOrbitalIdentity.js";
import { validate_landing_families } from "../sdk/orbitals/FractoOrbitalDiscovery.js";
import { build_orbital_trace_request } from "../sdk/orbitals/FractoOrbitalTraceRequest.js";
import { trace_known_dynamic_rays } from "../sdk/orbitals/FractoKnownDynamicRays.js";
import {
  ORBITAL_RAY_CACHE_VERSION,
  cached_orbital_rays,
} from "../sdk/orbitals/FractoOrbitalRayCache.js";
import { SEED_SURVEY_RAY_OPTIONS } from "../sdk/orbitals/FractoDynamicRays.js";

// Application sources are read only. All discovery, resume and selection writes
// belong to a fresh schema, removed on success or assertion failure.
const options = {},
  args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  assert.ok(
    [
      "--max-denominator",
      "--case",
      "--source-id",
      "--reference",
      "--output",
    ].includes(args[i]) && args[i + 1],
    "Invalid benchmark option",
  );
  options[args[i].slice(2)] = args[i + 1];
}
const maximum = Number(options["max-denominator"] || 31),
  source_id = options["source-id"] || "65";
const reference = options.reference || "full";
assert.ok(["full", "none"].includes(reference));
assert.ok(
  ["all", "unit_circle", "basilica", "stored_core"].includes(
    options.case || "all",
  ),
);
const catalog = await load_job_catalog(maximum),
  output = resolve(options.output || "logs/catalog_only_jobs_benchmark.json");
const schema = `fracto_compact_bench_${randomUUID().replaceAll("-", "")}`;
assert.match(schema, /^fracto_compact_bench_[a-f0-9]{32}$/);
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
  settings: {
    max_denominator: maximum,
    families: catalog.family_count,
    reference,
  },
  limitations: [
    "Single observations on a development machine. Cold discovery includes worker startup, SQL validation/publication and cancellation/resume; warm includes numerical evidence rechecks and SQL, with zero solver tasks.",
    "Full reference traces all family paths at its recorded profile. Compact discovery deliberately defers full geometry, and can retain pending assignments. Numerical validation is not interval certification.",
    "Selection timing includes only the chosen orbital, using the higher-accuracy shared rendering profile. Cached selection timing includes database read, decode and geometry validation, not browser transfer or paint.",
    "Catalog coverage is denominator-bounded and is not a claim that every mathematical orbital is known.",
  ],
  cases: [],
};
const event = (value) => console.log(JSON.stringify(value));
const settle = async () => {
  const deadline = Date.now() + 1200000;
  let last = 0;
  while (jobs.active.size && Date.now() < deadline) {
    if (Date.now() - last > 10000) {
      event({
        phase: "waiting",
        progress: [...jobs.active.values()].map((state) => ({
          processed: state.progress.catalog_processed,
          total: state.progress.catalog_total,
          orbitals: state.progress.orbital_count,
        })),
      });
      last = Date.now();
    }
    await pause(20);
  }
  assert.equal(
    jobs.active.size,
    0,
    "Benchmark exceeded twenty-minute deadline",
  );
};
const measured = async (operation) => {
  const start = performance.now();
  const value = await operation();
  return { value, ms: performance.now() - start };
};
try {
  const fixtures = [
    { id: "1", name: "unit_circle", parameter: { x: "0", y: "0" }, pattern: 1 },
    { id: "2", name: "basilica", parameter: { x: "-1", y: "0" }, pattern: 2 },
  ];
  if (["all", "stored_core"].includes(options.case || "all")) {
    const stored = await application.source(source_id);
    fixtures.push({
      id: "3",
      name: "stored_core",
      source_id,
      parameter: stored.parameter,
      pattern: stored.pattern,
    });
  }
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
    original = pool.run.bind(pool);
  pool.run = async (name, payload, ...rest) => {
    assert.equal(
      name,
      "orbital_catalog_representative",
      "No surveys or full-path tasks during compact discovery",
    );
    const start = performance.now(),
      call = { name, family_key: payload.family.key };
    calls.push(call);
    try {
      return await original(name, payload, ...rest);
    } finally {
      call.ms = performance.now() - start;
    }
  };
  const manager = () =>
    new OrbitalDiscoveryJobs({
      store,
      pool,
      task_timeout_ms: 120000,
      run_timeout_ms: 1200000,
    });
  for (const fixture of fixtures.filter(
    (row) =>
      !options.case || options.case === "all" || options.case === row.name,
  )) {
    event({ phase: "case_start", name: fixture.name, maximum });
    await admin.execute("INSERT INTO free_bailiwicks VALUES (?,?,?)", [
      fixture.id,
      JSON.stringify(fixture.parameter),
      fixture.pattern,
    ]);
    const request = discovery_request({
      free_bailiwick_id: fixture.id,
      request_key: `cold-${fixture.name}`,
      settings: { catalog_max_denominator: maximum },
    });
    const checkpoint = store.save_checkpoint.bind(store);
    let stopped = false;
    store.save_checkpoint = async (id, cp, token) => {
      await checkpoint(id, cp, token);
      if (
        !stopped &&
        cp.catalog?.family_index === Math.min(2, catalog.family_count)
      ) {
        stopped = true;
        await jobs.cancel(id);
      }
    };
    const cold_start = performance.now(),
      call_start = calls.length;
    jobs = manager();
    const initial = await jobs.start(request);
    await settle();
    assert.equal((await store.get_run(initial.id)).status, "cancelled");
    const before_cancel_ms = performance.now() - cold_start;
    store.save_checkpoint = checkpoint;
    jobs = manager();
    const resume_start = performance.now();
    await jobs.resume(initial.id);
    await settle();
    const resume_ms = performance.now() - resume_start,
      cold_ms = performance.now() - cold_start;
    const cold = await store.get_run(initial.id),
      cold_calls = calls.slice(call_start);
    assert.ok(["completed", "partial"].includes(cold.status), cold.error_code);
    assert.equal(cold_calls.length, catalog.family_count);
    assert.equal(
      new Set(cold_calls.map((call) => call.family_key)).size,
      catalog.family_count,
      "No family is retraced on resume",
    );
    assert.equal(
      cold.progress.catalog_coverage.investigated_families,
      catalog.family_count,
    );
    assert.equal(cold.progress.catalog_coverage.bound_exhausted, true);
    const source = await store.source(fixture.id);
    const [before_paths] = await admin.execute(
      "SELECT COUNT(*) AS count FROM orbital_ray_paths p JOIN orbital_progressions o ON o.id=p.orbital_id WHERE o.focal_key=?",
      [source.focal_key],
    );
    assert.equal(
      Number(before_paths[0].count),
      0,
      "Discovery creates no full geometry",
    );
    const warm_start = performance.now(),
      warm_calls = calls.length;
    jobs = manager();
    const warmed = await jobs.start({
      ...request,
      request_key: `warm-${fixture.name}`,
    });
    await settle();
    const warm_ms = performance.now() - warm_start,
      warm = await store.get_run(warmed.id);
    assert.equal(
      calls.length,
      warm_calls,
      "Warm discovery uses no worker tasks",
    );
    assert.equal(warm.progress.catalog_cache_hits, catalog.family_count);
    assert.equal(warm.status, cold.status);
    assert.deepEqual(
      warm.results.map((row) => row.orbital_id),
      cold.results.map((row) => row.orbital_id),
    );
    assert.equal(
      warm.progress.catalog_accepted,
      cold.progress.catalog_accepted,
    );
    const orbitals = [];
    for (const row of warm.results) {
      const orbital = await store.get(row.orbital_id),
        points = orbital.points.map((point) => point.point);
      assert.ok(canonical_orbital(fixture.parameter, points));
      assert.equal(orbital.selectable, true);
      assert.equal(orbital.lifecycle_state.paths.status, "missing");
      const ratios = orbital.points.flatMap((point) =>
        point.landing_ratios.map((ratio) => ({
          ...ratio,
          point_index: point.point_index,
        })),
      );
      if (ratios.length)
        validate_landing_families(ratios, orbital.period, {
          max_angle_period: 4096,
        });
      if (fixture.name === "unit_circle") {
        for (const point of orbital.points)
          for (const ratio of point.landing_ratios) {
            const theta =
              (2 * Math.PI * Number(ratio.numerator)) /
              Number(ratio.denominator);
            assert.ok(
              Math.hypot(
                Number(point.point.re) - Math.cos(theta),
                Number(point.point.im) - Math.sin(theta),
              ) < 1e-12,
              `Unit-circle landing differs for ${ratio.numerator}/${ratio.denominator}`,
            );
          }
      }
      orbitals.push(orbital);
    }
    const [ledger] = await admin.execute(
      "SELECT status,family_key,outcome FROM orbital_family_investigations WHERE focal_key=?",
      [source.focal_key],
    );
    let compact_bytes = 0,
      pending_candidates = 0;
    for (const row of ledger) {
      const outcome = await decode_orbital_cache(admin, row.outcome);
      assert.equal(outcome.rays?.length || 0, 0);
      compact_bytes += Buffer.byteLength(JSON.stringify(outcome));
      if (row.status !== "validated" && outcome.candidate) pending_candidates++;
    }
    const result = {
      name: fixture.name,
      parameter: fixture.parameter,
      pattern: fixture.pattern,
      settings: request.settings,
      profile: job_compact_profile(request.settings),
      timings: {
        cold_resumed_ms: cold_ms,
        before_cancel_ms,
        resume_ms,
        warm_ms,
        cold_to_warm_ratio: cold_ms / warm_ms,
        worker_ms: cold_calls.reduce((sum, row) => sum + row.ms, 0),
      },
      solver_tasks: cold_calls.length,
      warm_solver_tasks: 0,
      orbitals: orbitals.length,
      pending_candidates,
      compact_outcome_bytes: compact_bytes,
      paths_after_discovery: 0,
      coverage: warm.progress.catalog_coverage,
      verified: {
        resume_without_retracing: true,
        warm_without_workers: true,
        selectable_closed_cycles: true,
        no_discovery_geometry: true,
      },
    };
    if (reference === "full") {
      event({ phase: "full_reference", name: fixture.name });
      const measured_reference = await measured(() =>
        discover_catalog_orbitals(fixture.parameter, {
          ...job_catalog_profile(request.settings),
          catalog,
          retain_geometry: false,
        }),
      );
      const full = measured_reference.value;
      const by_angle = new Map(
        full.candidates.flatMap((candidate) =>
          candidate.landing_ratios.map((ratio) => [
            `${ratio.numerator}/${ratio.denominator}`,
            { candidate, ratio },
          ]),
        ),
      );
      let checked = 0;
      const absent = [];
      for (const orbital of orbitals)
        for (const point of orbital.points)
          for (const ratio of point.landing_ratios) {
            const key = `${ratio.numerator}/${ratio.denominator}`,
              other = by_angle.get(key);
            if (!other) {
              absent.push(key);
              continue;
            }
            assert.ok(
              same_orbital_cycle(
                orbital.points.map((p) => p.point),
                other.candidate.points,
                "1e-7",
              ),
              `Different cycle for ${key}`,
            );
            const target = other.candidate.points[other.ratio.point_index];
            assert.ok(
              Math.hypot(
                Number(target.re) - Number(point.point.re),
                Number(target.im) - Number(point.point.im),
              ) < 1e-7,
              `Different landing for ${key}`,
            );
            checked++;
          }
      const verified_keys = new Set(
        ledger
          .filter((row) => row.status === "validated")
          .map((row) => row.family_key),
      );
      result.full_reference = {
        ms: measured_reference.ms,
        profile: full.search.profile,
        verified_families: full.families.length,
        unresolved: full.unresolved,
        matched_ratios: checked,
        compact_ratios_absent_in_full_reference: absent,
        reference_only_families: full.families
          .filter((family) => !verified_keys.has(family.catalog_key))
          .map((family) => family.catalog_key),
      };
    }
    const selected =
      orbitals.find((orbital) =>
        orbital.points.some((point) =>
          point.landing_ratios.some(
            (ratio) => ratio.numerator === "1" && ratio.denominator === "7",
          ),
        ),
      ) ||
      orbitals.find((orbital) =>
        orbital.points.some((point) => point.landing_ratios.length),
      );
    if (selected) {
      const paths = new OrbitalRayPathStore({
        connect: () => ({ promise: () => admin }),
        disconnect: () => {},
        store,
      });
      assert.equal(await paths.get(selected.orbital_id), null);
      const trace_request = build_orbital_trace_request(
        fixture.parameter,
        selected,
      );
      const traced = await measured(() =>
        trace_known_dynamic_rays(trace_request),
      );
      assert.equal(
        traced.value.status,
        "rays_found",
        JSON.stringify(traced.value.unresolved),
      );
      const payload = {
        version: ORBITAL_RAY_CACHE_VERSION,
        request: trace_request,
        rays: traced.value.rays,
        quality: SEED_SURVEY_RAY_OPTIONS,
      };
      const saved = await measured(() =>
        paths.put(selected.orbital_id, payload),
      );
      const cached = await measured(async () =>
        cached_orbital_rays(
          await paths.get(selected.orbital_id),
          trace_request,
        ),
      );
      assert.equal(cached.value.length, trace_request.requests.length);
      const [counts] = await admin.execute(
        "SELECT COUNT(*) AS count FROM orbital_ray_paths p JOIN orbital_progressions o ON o.id=p.orbital_id WHERE o.focal_key=?",
        [source.focal_key],
      );
      assert.equal(
        Number(counts[0].count),
        1,
        "Only the selected orbital receives geometry",
      );
      assert.equal(
        (await store.get(selected.orbital_id)).lifecycle_state.paths.status,
        "cached",
      );
      result.selection = {
        period: selected.period,
        rays: cached.value.length,
        trace_ms: traced.ms,
        save_ms: saved.ms,
        persistent_load_ms: cached.ms,
        payload_bytes: Buffer.byteLength(JSON.stringify(payload)),
        quality: SEED_SURVEY_RAY_OPTIONS,
        only_selected_orbital_cached: true,
      };
    }
    report.cases.push(result);
    event({
      phase: "case_complete",
      name: fixture.name,
      timings: result.timings,
      selection: result.selection,
      orbitals: result.orbitals,
      verified: warm.progress.catalog_accepted,
      unresolved: warm.progress.catalog_unresolved,
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
  report.finished_at = new Date().toISOString();
  report.peak_rss_bytes = process.resourceUsage().maxRSS * 1024;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
}
event({
  phase: "complete",
  output,
  cases: report.cases.length,
  disposable_schema_removed: report.disposable_schema_removed,
});
