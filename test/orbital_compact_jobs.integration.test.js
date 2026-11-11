import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fork } from "node:child_process";
import { once } from "node:events";

test(
  "catalog-only jobs resume and reuse compact evidence, deferring geometry until selection",
  {
    skip: process.env.FRACTO_DB_INTEGRATION !== "1",
  },
  async () => {
    const { open_orbital_database, create_orbital_database_pool } =
      await import("../servers/fracto-data-server/handlers/orbital_data_database.js");
    const { OrbitalDataStore } =
      await import("../servers/fracto-data-server/handlers/orbital_data_store.js");
    const { OrbitalDiscoveryJobs } =
      await import("../servers/fracto-data-server/handlers/orbital_data_jobs.js");
    const { WorkerTaskPool } =
      await import("../servers/fracto-data-server/handlers/worker_task_pool.js");
    const { discovery_request } =
      await import("../servers/fracto-data-server/handlers/orbital_data_contract.js");
    const schema = `fracto_compact_job_test_${randomUUID().replaceAll("-", "")}`;
    assert.match(schema, /^fracto_compact_job_test_[a-f0-9]{32}$/);
    const admin = await open_orbital_database();
    let database,
      pool,
      jobs,
      created = false;
    const wait = async () => {
      const deadline = Date.now() + 60000;
      while (jobs.active.size && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(jobs.active.size, 0);
    };
    try {
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
      await admin.execute("INSERT INTO free_bailiwicks VALUES (55,?,1)", [
        JSON.stringify({ x: "0", y: "0" }),
      ]);
      database = await create_orbital_database_pool(schema);
      const store = new OrbitalDataStore({
        open: () => database.getConnection(),
      });
      pool = new WorkerTaskPool({ size: 1, task_timeout_ms: 30000 });
      const calls = [],
        original_run = pool.run.bind(pool);
      let pending = false,
        obsolete = false;
      pool.run = async (name, payload, ...rest) => {
        assert.equal(
          name,
          "orbital_catalog_representative",
          "catalog-only jobs must not survey or trace full families",
        );
        calls.push(payload.family.key);
        const result = await original_run(name, payload, ...rest);
        if (obsolete && payload.family.key === "1/7")
          return {
            status: "unresolved",
            reason: "confirmation_depth_limit",
            confirmation_revision: 1,
            refinement_attempts: [],
          };
        if (pending && payload.family.key === "1/7")
          return {
            ...result,
            status: "assignments_pending",
            reason: "association_unresolved",
            landing_ratios: [],
            rays: [],
          };
        return result;
      };
      const make = () =>
        new OrbitalDiscoveryJobs({
          store,
          pool,
          run_timeout_ms: 60000,
          task_timeout_ms: 30000,
        });
      jobs = make();
      const request = discovery_request({
        free_bailiwick_id: "55",
        request_key: "compact-resume",
        settings: { catalog_max_denominator: 7 },
      });
      assert.equal(
        request.settings.discovery_strategy,
        "catalog-representative-rays-v1",
      );
      const source = await store.source("55");
      const run = await store.create_run(source, request);
      const original_save = store.save_checkpoint.bind(store);
      let cancelled = false;
      store.save_checkpoint = async (id, cp, token) => {
        await original_save(id, cp, token);
        if (!cancelled && cp.catalog?.family_index === 2) {
          cancelled = true;
          await store.cancel(id);
        }
      };
      await jobs.resume(run.id);
      await wait();
      assert.equal((await store.get_run(run.id)).status, "cancelled");
      assert.equal(calls.length, 2);
      store.save_checkpoint = original_save;
      jobs = make();
      await jobs.resume(run.id);
      await wait();
      const completed = await store.get_run(run.id);
      assert.equal(completed.status, "completed", completed.error_code);
      assert.equal(completed.results.length, 5);
      assert.equal(completed.progress.catalog_coverage.validated_families, 5);
      assert.equal(calls.length, 5);
      assert.equal(new Set(calls).size, 5);
      for (const result of completed.results) {
        const orbital = await store.get(result.orbital_id);
        assert.equal(orbital.lifecycle_state.assignments, "verified");
        assert.equal(orbital.lifecycle_state.paths.status, "missing");
        assert.equal(orbital.selectable, true);
        assert.ok(
          orbital.points.every(
            (point) => point.point.re !== "0" || point.point.im !== "0",
          ),
        );
      }
      const survey = await store.latest_survey(source.parameter);
      assert.equal(survey.coverage.validated_families, 5);
      const warm = await store.create_run(source, {
        ...request,
        request_key: "compact-warm",
      });
      await jobs.resume(warm.id);
      await wait();
      const cached = await store.get_run(warm.id);
      assert.equal(cached.status, "completed", cached.error_code);
      assert.equal(cached.progress.catalog_cache_hits, 5);
      assert.equal(calls.length, 5, "warm runs do not invoke a ray solver");
      assert.deepEqual(
        cached.results.map((row) => row.orbital_id).sort(),
        completed.results.map((row) => row.orbital_id).sort(),
      );
      const crash_request = discovery_request({
        free_bailiwick_id: "55",
        request_key: "hard-crash",
        settings: { catalog_max_denominator: 7, precision_digits: 144 },
      });
      const crash_run = await store.create_run(source, crash_request);
      const child = fork(
        new URL("./orbital_catalog_crash.fixture.js", import.meta.url),
        [],
        {
          execArgv: [],
          env: {
            ...process.env,
            FRACTO_CATALOG_CRASH_SCHEMA: schema,
            FRACTO_CATALOG_CRASH_RUN: crash_run.id,
          },
          stdio: ["ignore", "ignore", "inherit", "ipc"],
        },
      );
      const exited = once(child, "exit");
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(Error("compact crash fixture timed out")),
            30000,
          );
          child.on("message", (message) => {
            if (message.event === "ledger_committed") {
              clearTimeout(timer);
              resolve();
            }
          });
          child.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
          });
          child.once("exit", () => {
            clearTimeout(timer);
            reject(Error("fixture exited before commit"));
          });
        });
      } finally {
        child.kill("SIGKILL");
        await exited;
      }
      await admin.execute(
        "UPDATE orbital_discovery_runs SET lease_expires_at=DATE_SUB(NOW(3),INTERVAL 1 SECOND) WHERE id=?",
        [crash_run.id],
      );
      const before_crash_resume = calls.length;
      await jobs.resume(crash_run.id);
      await wait();
      const recovered = await store.get_run(crash_run.id);
      assert.equal(recovered.status, "completed", recovered.error_code);
      assert.equal(recovered.progress.catalog_cache_hits, 1);
      assert.equal(
        calls.length - before_crash_resume,
        4,
        "committed compact evidence survives process death",
      );
      // Fresh precision isolates an unresolved assignment from previously verified results.
      pending = true;
      const pending_request = discovery_request({
        free_bailiwick_id: "55",
        request_key: "pending",
        settings: { catalog_max_denominator: 7, precision_digits: 160 },
      });
      const pending_run = await store.create_run(source, pending_request);
      await jobs.resume(pending_run.id);
      await wait();
      const partial = await store.get_run(pending_run.id);
      assert.equal(partial.status, "partial", partial.error_code);
      assert.equal(
        partial.results.length,
        5,
        "a closed orbital survives unresolved assignments",
      );
      assert.equal(partial.progress.catalog_coverage.unresolved_families, 1);
      // Existing verified assignments are retained when an additional investigation is inconclusive.
      for (const result of partial.results)
        assert.equal(
          (await store.get(result.orbital_id)).lifecycle_state.assignments,
          "verified",
        );
      await admin.execute("INSERT INTO free_bailiwicks VALUES (56,?,1)", [
        JSON.stringify({ x: "0.01", y: "0.02" }),
      ]);
      const fresh_request = discovery_request({
        free_bailiwick_id: "56",
        request_key: "fresh-pending",
        settings: { catalog_max_denominator: 7 },
      });
      const fresh_run = await store.create_run(
        await store.source("56"),
        fresh_request,
      );
      await jobs.resume(fresh_run.id);
      await wait();
      const fresh = await store.get_run(fresh_run.id);
      assert.equal(fresh.status, "partial", fresh.error_code);
      assert.equal(fresh.results.length, 5);
      const fresh_orbitals = await Promise.all(
        fresh.results.map((row) => store.get(row.orbital_id)),
      );
      const unassigned = fresh_orbitals.filter(
        (orbital) => orbital.lifecycle_state.assignments === "pending",
      );
      assert.equal(unassigned.length, 1);
      assert.equal(unassigned[0].selectable, true);
      assert.ok(
        unassigned[0].points.every(
          (point) => point.landing_ratios.length === 0,
        ),
      );
      assert.equal(unassigned[0].lifecycle_state.paths.status, "missing");
      for (const table of ["orbital_ray_paths", "orbital_ray_cache_chunks"]) {
        const [rows] = await admin.query(
          `SELECT COUNT(*) AS count FROM ${table}`,
        );
        assert.equal(
          Number(rows[0].count),
          0,
          `${table} remains empty during discovery`,
        );
      }
      const { OrbitalRayPathStore } =
        await import("../servers/fracto-data-server/handlers/orbital_ray_paths.js");
      const { build_orbital_trace_request } =
        await import("../sdk/orbitals/FractoOrbitalTraceRequest.js");
      const { trace_known_dynamic_rays } =
        await import("../sdk/orbitals/FractoKnownDynamicRays.js");
      const { ORBITAL_RAY_CACHE_VERSION, cached_orbital_rays } =
        await import("../sdk/orbitals/FractoOrbitalRayCache.js");
      const { SEED_SURVEY_RAY_OPTIONS } =
        await import("../sdk/orbitals/FractoDynamicRays.js");
      const selected = (
        await Promise.all(
          completed.results.map((row) => store.get(row.orbital_id)),
        )
      ).find((orbital) => orbital.period === 2);
      const paths = new OrbitalRayPathStore({
        connect: () => ({ promise: () => admin }),
        disconnect: () => {},
        store,
      });
      assert.equal(await paths.get(selected.orbital_id), null);
      const selected_request = build_orbital_trace_request(
        source.parameter,
        selected,
      );
      const traced = await trace_known_dynamic_rays(selected_request);
      assert.equal(traced.status, "rays_found");
      await paths.put(selected.orbital_id, {
        version: ORBITAL_RAY_CACHE_VERSION,
        request: selected_request,
        rays: traced.rays,
        quality: SEED_SURVEY_RAY_OPTIONS,
      });
      assert.equal(
        cached_orbital_rays(
          await paths.get(selected.orbital_id),
          selected_request,
        ).length,
        2,
      );
      assert.equal(
        (await store.get(selected.orbital_id)).lifecycle_state.paths.status,
        "cached",
      );
      for (const row of completed.results.filter(
        (row) => row.orbital_id !== selected.orbital_id,
      ))
        assert.equal(
          (await store.get(row.orbital_id)).lifecycle_state.paths.status,
          "missing",
          "unselected orbitals retain no geometry",
        );
      // Reproduce a format-3 job finished by the old confirmation code. Its
      // verified families and existing selected path cache must survive repair.
      pending = false;
      obsolete = true;
      const repair_request = discovery_request({
        free_bailiwick_id: "55",
        request_key: "confirmation-repair",
        settings: { catalog_max_denominator: 7, precision_digits: 192 },
      });
      const old_run = await store.create_run(source, repair_request);
      await jobs.resume(old_run.id);
      await wait();
      const { decode_checkpoint, encode_checkpoint } =
        await import("../servers/fracto-data-server/handlers/orbital_data_checkpoint.js");
      const [checkpoints] = await admin.execute(
        "SELECT payload FROM orbital_discovery_checkpoints WHERE run_id=?",
        [old_run.id],
      );
      const old_checkpoint = await decode_checkpoint(checkpoints[0].payload);
      assert.equal(old_checkpoint.catalog.unresolved, 1);
      delete old_checkpoint.catalog.confirmation_revision;
      delete old_checkpoint.progress.catalog_confirmation_revision;
      await admin.execute(
        "UPDATE orbital_discovery_checkpoints SET payload=? WHERE run_id=?",
        [await encode_checkpoint(old_checkpoint), old_run.id],
      );
      await admin.execute(
        "UPDATE orbital_discovery_runs SET progress=? WHERE id=?",
        [JSON.stringify(old_checkpoint.progress), old_run.id],
      );
      assert.equal(
        (await store.get_run(old_run.id)).resumable,
        true,
        "old completed confirmation limits offer resume",
      );
      assert.equal(
        (await store.get_run(old_run.id)).confirmation_repair_available,
        true,
      );
      const claimed = await store.claim_run(old_run.id);
      assert.equal(claimed.checkpoint.catalog.family_index, 5);
      assert.deepEqual(claimed.checkpoint.catalog.confirmation_retry_keys, [
        "1/7",
      ]);
      const [prepared] = await admin.execute(
        "SELECT payload FROM orbital_discovery_checkpoints WHERE run_id=?",
        [old_run.id],
      );
      assert.equal(
        (await decode_checkpoint(prepared[0].payload)).stage,
        "catalog",
        "retry queue is durable before a worker starts",
      );
      await admin.execute(
        "UPDATE orbital_discovery_runs SET lease_expires_at=DATE_SUB(NOW(3),INTERVAL 1 SECOND) WHERE id=?",
        [old_run.id],
      );
      obsolete = false;
      const before_repair = calls.length,
        save_rays = store.save_rays.bind(store);
      let fail_repair_publication = true;
      store.save_rays = async (...args) => {
        if (fail_repair_publication) {
          fail_repair_publication = false;
          throw Error("injected repair publication failure");
        }
        return save_rays(...args);
      };
      jobs = make();
      await jobs.resume(old_run.id);
      await wait();
      assert.equal((await store.get_run(old_run.id)).resumable, true);
      store.save_rays = save_rays;
      jobs = make();
      await jobs.resume(old_run.id);
      await wait();
      const repaired = await store.get_run(old_run.id);
      assert.equal(repaired.status, "completed", repaired.error_code);
      assert.equal(repaired.progress.catalog_processed, 5);
      assert.equal(repaired.progress.catalog_accepted, 5);
      assert.equal(repaired.progress.catalog_unresolved, 0);
      assert.equal(repaired.progress.catalog_confirmation_retries, 1);
      assert.equal(repaired.confirmation_repair_available, false);
      assert.deepEqual(
        calls.slice(before_repair),
        ["1/7"],
        "only the stale family is calculated, even after publication failure",
      );
      assert.equal(
        (await store.get(selected.orbital_id)).lifecycle_state.paths.status,
        "cached",
      );
      const after_repair = calls.length;
      const fresh_repair = await store.create_run(source, {
        ...repair_request,
        request_key: "confirmation-repair-warm",
      });
      await jobs.resume(fresh_repair.id);
      await wait();
      assert.equal(
        (await store.get_run(fresh_repair.id)).progress.catalog_cache_hits,
        5,
      );
      assert.equal(calls.length, after_repair);
      const stopped = await store.create_run(source, {
        ...request,
        request_key: "before-rediscovery",
      });
      await store.cancel(stopped.id);
      assert.equal((await store.latest_job(source)).id, stopped.id);
      const rediscovery = await store.create_run(source, {
        ...request,
        request_key: "rediscovery",
        settings: { ...request.settings, catalog_retry_unresolved: 1 },
        rediscover: true,
      });
      assert.equal(
        (await store.get_run(stopped.id)).progress.superseded_by,
        rediscovery.id,
      );
      await jobs.resume(rediscovery.id);
      await wait();
      const regenerated = await store.get_run(rediscovery.id);
      assert.equal(regenerated.status, "completed", regenerated.error_code);
      assert.equal(regenerated.results.length, 5);
      assert.equal(regenerated.progress.catalog_cache_hits, 5);
      assert.equal(
        calls.length,
        after_repair,
        "rediscovery reuses verified compact evidence",
      );
      assert.equal(
        await store.latest_job(source),
        null,
        "superseded stopped jobs do not shadow the completed list",
      );
      assert.equal(
        (await store.get(selected.orbital_id)).lifecycle_state.paths.status,
        "cached",
      );
    } finally {
      await pool?.close();
      if (jobs)
        await Promise.allSettled(
          [...jobs.active.values()].map((state) => state.completion),
        );
      await database?.end();
      if (created) await admin.query(`DROP DATABASE \`${schema}\``);
      await admin.end();
    }
  },
);
