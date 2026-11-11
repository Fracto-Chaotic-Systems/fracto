import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fork } from "node:child_process";
import { once } from "node:events";

test(
  "resumable catalog jobs recover replaced owners, preserve survey evidence, and publish all additional cycles",
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
    const { OrbitalFamilyInvestigationStore } =
      await import("../servers/fracto-data-server/handlers/orbital_family_investigations.js");
    const { discovery_request } =
      await import("../servers/fracto-data-server/handlers/orbital_data_contract.js");
    const { load_job_catalog, job_catalog_profile } =
      await import("../servers/fracto-data-server/handlers/orbital_catalog_jobs.js");
    const { catalog_doubling_families } =
      await import("../sdk/orbitals/FractoDenominatorCatalog.js");
    const { CATALOG_ORBITAL_DISCOVERY_VERSION } =
      await import("../sdk/orbitals/FractoCatalogOrbitalDiscovery.js");
    const schema = `fracto_catalog_job_test_${randomUUID().replaceAll("-", "")}`;
    assert.match(schema, /^fracto_catalog_job_test_[a-f0-9]{32}$/);
    const admin = await open_orbital_database();
    let created = false,
      database,
      pool,
      jobs;
    const wait = async () => {
      const deadline = Date.now() + 60000;
      while (jobs.active.size && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(jobs.active.size, 0, "job must reach a durable outcome");
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
      const family_store = new OrbitalFamilyInvestigationStore({
        database: store,
      });
      const request = discovery_request({
        free_bailiwick_id: "55",
        request_key: "catalog-recovery",
        settings: {
          grid_size: 3,
          max_orbitals: 2,
          catalog_max_denominator: 7,
          discovery_strategy: "survey-catalog-full-rays-v1",
        },
      });
      const source = await store.source("55"),
        run = await store.create_run(source, request),
        old = await store.claim_run(run.id);
      const seed = (point, rank) => ({
        points: [{ re: point, im: "0" }],
        precision_digits: 64,
        discovery_method: "seed_survey_scan",
        discovery_metadata: {
          algorithm: "seed-survey-scan-v1",
          rank,
          confidence: 1,
          discovery_count: 17 + rank,
        },
      });
      const attractor = await store.save_orbital(
        run.id,
        source,
        seed("0", 0),
        old.token,
      );
      const approximate = await store.save_orbital(
        run.id,
        source,
        seed("1.00000000000001", 1),
        old.token,
      );
      const before_rays = await store.get(approximate.id);
      assert.equal(before_rays.lifecycle_state.orbital, "validated");
      assert.equal(before_rays.lifecycle_state.assignments, "pending");
      assert.equal(before_rays.lifecycle_state.paths.status, "missing");
      assert.equal(before_rays.selectable, true);
      await store.save_rays(
        run.id,
        approximate,
        {
          status: "rays_found",
          ratios: [
            {
              numerator: "0",
              denominator: "1",
              family_key: "0/1",
              angle_period: 1,
              point_index: 0,
              landing_error: 1e-14,
            },
          ],
          metadata: { strategy: "state-contract-test" },
        },
        old.token,
      );
      const without_paths = await store.get(approximate.id);
      assert.equal(without_paths.lifecycle_state.assignments, "verified");
      assert.equal(without_paths.lifecycle_state.paths.status, "missing");
      old.checkpoint.stage = "catalog";
      delete old.checkpoint.discovery_strategy; // historical format-2 checkpoint
      old.checkpoint.orbitals = [attractor, approximate];
      old.checkpoint.progress.orbital_count = 2;
      await store.save_checkpoint(run.id, old.checkpoint, old.token);
      const catalog = await load_job_catalog(7),
        family = [...catalog_doubling_families(catalog)][0];
      const context = {
        parameter: source.parameter,
        family,
        profile: job_catalog_profile(request.settings),
        catalog_version: catalog.version,
        solver_version: CATALOG_ORBITAL_DISCOVERY_VERSION,
      };
      const old_owner = { run_id: run.id, execution_token: old.token };
      const abandoned = await family_store.claim(context, { owner: old_owner });
      // Reproduce a dead process with a live family lease and an expired job lease.
      await admin.execute(
        "UPDATE orbital_discovery_runs SET lease_expires_at=DATE_SUB(NOW(3),INTERVAL 1 SECOND) WHERE id=?",
        [run.id],
      );
      pool = new WorkerTaskPool({ size: 1, task_timeout_ms: 30000 });
      const calls = [],
        original_run = pool.run.bind(pool);
      pool.run = (name, ...args) => {
        calls.push(name);
        return original_run(name, ...args);
      };
      jobs = new OrbitalDiscoveryJobs({
        store,
        pool,
        family_store,
        run_timeout_ms: 60000,
        task_timeout_ms: 30000,
      });
      await jobs.resume(run.id);
      await wait();
      const completed = await store.get_run(run.id);
      assert.equal(completed.status, "completed", completed.error_code);
      assert.equal(completed.resume_count, 1);
      assert.equal(completed.results.length, 6);
      assert.equal(completed.progress.catalog_processed, 5);
      assert.equal(completed.progress.all_orbitals_discovered, false);
      assert.equal(
        calls.filter((name) => name === "orbital_catalog_family").length,
        5,
      );
      assert.equal(calls.includes("orbital_landing_ratios"), false);
      const stored = await store.get(approximate.id);
      assert.equal(stored.points[0].point.re, "1.00000000000001");
      assert.equal(stored.discovery_metadata.rank, 1);
      assert.equal(stored.discovery_metadata.confidence, 1);
      assert.equal(stored.discovery_metadata.discovery_count, 18);
      assert.equal(stored.lifecycle_state.assignments, "verified");
      assert.equal(stored.lifecycle_state.paths.status, "cached");
      assert.equal(stored.lifecycle_state.paths.cached_rays, 1);
      assert.equal(completed.discovery_strategy, "survey-catalog-full-rays-v1");
      assert.deepEqual(stored.discovery_metadata.catalog.family_keys, ["0/1"]);
      const ranked = await store.latest_survey(source.parameter);
      assert.deepEqual(ranked.coverage, completed.progress.catalog_coverage);
      assert.equal(ranked.coverage.tested_through_denominator, 7);
      assert.equal(ranked.coverage.validated_families, 5);
      assert.deepEqual(ranked.coverage, completed.progress.catalog_coverage);
      assert.equal(ranked.coverage.tested_through_denominator, 7);
      assert.equal(ranked.coverage.validated_families, 5);
      assert.equal(ranked.result[0].id, attractor.id);
      assert.equal(ranked.result[1].id, approximate.id);
      const [paths] = await admin.query(
        "SELECT COUNT(*) AS count FROM orbital_ray_paths",
      );
      assert.equal(Number(paths[0].count), 5);
      const [history] = await admin.query(
        "SELECT reason FROM orbital_family_investigation_attempts",
      );
      assert.ok(history.some((attempt) => attempt.reason === "owner_replaced"));
      const outcome = (await family_store.get(context)).outcome;
      await assert.rejects(
        family_store.complete(context, abandoned.token, outcome, old_owner),
        /job_not_active/,
      );

      const before = calls.filter(
        (name) => name === "orbital_catalog_family",
      ).length;
      const next = await jobs.start(
        discovery_request({
          free_bailiwick_id: "55",
          request_key: "catalog-cache-reuse",
          settings: request.settings,
        }),
      );
      await wait();
      const reused = await store.get_run(next.id);
      assert.equal(reused.status, "completed", reused.error_code);
      assert.equal(reused.progress.catalog_cache_hits, 5);
      assert.equal(
        (await store.latest_survey(source.parameter)).coverage.cache_hits,
        5,
      );
      assert.equal(
        (await store.latest_survey(source.parameter)).coverage.cache_hits,
        5,
      );
      assert.equal(reused.results.length, 5);
      assert.equal(
        calls.filter((name) => name === "orbital_catalog_family").length,
        before,
      );
      assert.ok(calls.includes("orbital_survey_rows"));
      assert.ok(calls.includes("orbital_survey_scan"));
      const [counts] = await admin.query(
        "SELECT COUNT(*) AS count FROM orbital_progressions",
      );
      assert.equal(Number(counts[0].count), 6);
      const [sources] = await admin.query(
        "SELECT core_point FROM free_bailiwicks WHERE id=55",
      );
      assert.deepEqual(
        typeof sources[0].core_point === "string"
          ? JSON.parse(sources[0].core_point)
          : sources[0].core_point,
        { x: "0", y: "0" },
      );
      const legacy_settings = Object.fromEntries(
        Object.entries(request.settings).filter(
          ([key]) =>
            !key.startsWith("catalog_") && key !== "discovery_strategy",
        ),
      );
      const legacy = await store.create_run(source, {
        ...request,
        request_key: "legacy-settings",
        settings: legacy_settings,
      });
      const legacy_claim = await store.claim_run(legacy.id);
      assert.equal(legacy_claim.owned, true);
      assert.equal(
        legacy_claim.settings.catalog_max_denominator,
        0,
        "old jobs retain their original discovery strategy",
      );
      await store.cancel(legacy.id);
      const crash_request = discovery_request({
        free_bailiwick_id: "55",
        request_key: "hard-process-crash",
        settings: {
          grid_size: 3,
          catalog_max_denominator: 7,
          precision_digits: 160,
          discovery_strategy: "survey-catalog-full-rays-v1",
        },
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
        const committed = await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(Error("crash fixture did not commit a family")),
            30000,
          );
          child.on("message", (message) => {
            if (message.event === "ledger_committed") {
              clearTimeout(timer);
              resolve(message);
            }
          });
          child.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
          });
          child.once("exit", () => {
            clearTimeout(timer);
            reject(Error("crash fixture exited before ledger commit"));
          });
        });
        assert.equal(committed.family_key, "0/1");
      } finally {
        child.kill("SIGKILL");
        await exited;
      }
      await admin.execute(
        "UPDATE orbital_discovery_runs SET lease_expires_at=DATE_SUB(NOW(3),INTERVAL 1 SECOND) WHERE id=?",
        [crash_run.id],
      );
      const before_crash_resume = calls.filter(
        (name) => name === "orbital_catalog_family",
      ).length;
      await jobs.resume(crash_run.id);
      await wait();
      const recovered = await store.get_run(crash_run.id);
      assert.equal(recovered.status, "completed", recovered.error_code);
      assert.equal(
        recovered.progress.catalog_cache_hits,
        1,
        "committed family survives actual process death",
      );
      assert.equal(
        calls.filter((name) => name === "orbital_catalog_family").length -
          before_crash_resume,
        4,
      );
      assert.equal(recovered.progress.catalog_coverage.validated_families, 5);
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
