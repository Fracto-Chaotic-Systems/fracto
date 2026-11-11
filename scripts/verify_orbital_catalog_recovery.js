import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { setTimeout as pause } from "node:timers/promises";
import { WorkerTaskPool } from "../servers/fracto-data-server/handlers/worker_task_pool.js";
import { OrbitalDataStore } from "../servers/fracto-data-server/handlers/orbital_data_store.js";
import {
  open_orbital_database,
  create_orbital_database_pool,
} from "../servers/fracto-data-server/handlers/orbital_data_database.js";
import { OrbitalDiscoveryJobs } from "../servers/fracto-data-server/handlers/orbital_data_jobs.js";
import { discovery_request } from "../servers/fracto-data-server/handlers/orbital_data_contract.js";
import { decode_checkpoint } from "../servers/fracto-data-server/handlers/orbital_data_checkpoint.js";
import { OrbitalRayPathStore } from "../servers/fracto-data-server/handlers/orbital_ray_paths.js";
import { cached_orbital_rays } from "../sdk/orbitals/FractoOrbitalRayCache.js";
import { build_orbital_trace_request } from "../sdk/orbitals/FractoOrbitalTraceRequest.js";
import {
  job_catalog_profile,
  load_job_catalog,
} from "../servers/fracto-data-server/handlers/orbital_catalog_jobs.js";
import { catalog_doubling_families } from "../sdk/orbitals/FractoDenominatorCatalog.js";
import { orbital_parameter } from "../sdk/orbitals/FractoOrbitalIdentity.js";

// Read an existing stopped job; reproduce its checkpoint in an isolated schema.
// Optional saved worker output avoids retracing the exact diagnostic family.
assert.ok(
  process.argv[2],
  "Usage: node scripts/verify_orbital_catalog_recovery.js RUN_ID [WORKER_FIXTURE.gz]",
);
const application = new OrbitalDataStore(),
  admin = await open_orbital_database();
const schema = `fracto_catalog_recovery_${randomUUID().replaceAll("-", "")}`;
assert.match(schema, /^fracto_catalog_recovery_[a-f0-9]{32}$/);
let created = false,
  database,
  pool,
  jobs;
const evidence = { source_run_id: process.argv[2] };
try {
  const original = await application.get_run(process.argv[2]);
  const [rows] = await admin.execute(
    "SELECT payload FROM orbital_discovery_checkpoints WHERE run_id=?",
    [original.id],
  );
  const checkpoint = await decode_checkpoint(rows[0].payload);
  const start_index = checkpoint.catalog.family_index;
  const blocked_family = [
    ...catalog_doubling_families(
      await load_job_catalog(original.settings.catalog_max_denominator),
    ),
  ][start_index];
  assert.equal(checkpoint.stage, "catalog");
  const fixture = process.argv[3]
    ? JSON.parse(gunzipSync(await readFile(process.argv[3])))
    : null;
  if (fixture)
    assert.deepEqual(
      orbital_parameter(fixture.context.parameter),
      orbital_parameter(original.focal_point),
    );
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
  await admin.execute("INSERT INTO free_bailiwicks VALUES (1,?,?)", [
    JSON.stringify(original.focal_point),
    original.source_pattern,
  ]);
  database = await create_orbital_database_pool(schema);
  const store = new OrbitalDataStore({ open: () => database.getConnection() });
  const request = discovery_request({
    free_bailiwick_id: "1",
    settings: original.settings,
  });
  const source = await store.source("1"),
    run = await store.create_run(source, request),
    claimed = await store.claim_run(run.id);
  checkpoint.input_hash = claimed.checkpoint.input_hash;
  checkpoint.orbitals = [];
  checkpoint.candidates = [];
  Object.assign(checkpoint.catalog, {
    matched_ids: [],
    accepted: 0,
    unresolved: 0,
    cache_hits: 0,
    unresolved_details: [],
  });
  checkpoint.progress = {
    attempts: 0,
    orbital_count: 0,
    ratios: 0,
    ray_outcomes: {},
  };
  await store.save_checkpoint(run.id, checkpoint, claimed.token);
  await admin.execute(
    "UPDATE orbital_discovery_runs SET lease_expires_at=DATE_SUB(NOW(3),INTERVAL 1 SECOND) WHERE id=?",
    [run.id],
  );
  const save = store.save_checkpoint.bind(store);
  const cursors = [];
  store.save_checkpoint = async (id, cp, token) => {
    await save(id, cp, token);
    cursors.push(cp.catalog.family_index);
    if (cp.catalog.family_index === start_index + 2) await jobs.cancel(id);
  };
  pool = new WorkerTaskPool({ size: 1, task_timeout_ms: 300000 });
  const task = pool.run.bind(pool);
  pool.run = (name, payload, ...rest) =>
    fixture && payload.family?.key === fixture.context.family.key
      ? Promise.resolve(structuredClone(fixture.result))
      : task(name, payload, ...rest);
  jobs = new OrbitalDiscoveryJobs({ store, pool, task_timeout_ms: 300000 });
  await jobs.resume(run.id);
  const deadline = Date.now() + 300000;
  while (jobs.active.size && Date.now() < deadline) await pause(100);
  assert.equal(jobs.active.size, 0);
  const recovered = await store.get_run(run.id);
  assert.equal(recovered.status, "cancelled", recovered.error_code);
  assert.equal(recovered.progress.catalog_processed, start_index + 2);
  const [chunks] = await admin.query(
    "SELECT COUNT(*) AS count,MAX(OCTET_LENGTH(payload)) AS max_bytes FROM orbital_ray_cache_chunks",
  );
  assert.ok(Number(chunks[0].count) > 1);
  assert.ok(Number(chunks[0].max_bytes) <= 8 * 1024 * 1024);
  const connection = await database.getConnection();
  try {
    const paths = new OrbitalRayPathStore({
      store,
      connect: () => ({ promise: () => connection }),
      disconnect: () => {},
    });
    const orbital = await store.get(recovered.results[0].orbital_id);
    const cache = await paths.get(orbital.orbital_id);
    const trace_request = build_orbital_trace_request(
      source.parameter,
      orbital,
    );
    const rays = cached_orbital_rays(
      cache,
      trace_request,
      job_catalog_profile(request.settings),
    );
    assert.equal(rays.length, blocked_family.angle_period);
    Object.assign(evidence, {
      start_index,
      final_index: recovered.progress.catalog_processed,
      cursors,
      chunk_rows: Number(chunks[0].count),
      maximum_chunk_bytes: Number(chunks[0].max_bytes),
      cached_rays: rays.length,
    });
  } finally {
    connection.release();
  }
} finally {
  if (jobs)
    for (const id of jobs.active.keys()) await jobs.cancel(id).catch(() => {});
  await pool?.close();
  if (jobs)
    await Promise.allSettled(
      [...jobs.active.values()].map((state) => state.completion),
    );
  await database?.end();
  await application.close();
  if (created) {
    await admin.query(`DROP DATABASE \`${schema}\``);
    evidence.disposable_schema_removed = true;
  }
  await admin.end();
}
await mkdir(new URL("../logs/", import.meta.url), { recursive: true });
await writeFile(
  new URL(
    "../logs/orbital_catalog_recovery_verification.json",
    import.meta.url,
  ),
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(JSON.stringify(evidence));
