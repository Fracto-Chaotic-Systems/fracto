import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";
import Decimal from "decimal.js";
import { internal_service_headers } from "../utils/service_authorization.js";
import {
  OrbitalDataStore,
  open_orbital_database,
} from "../servers/fracto-data-server/handlers/orbital_data_store.js";
import { positive_id } from "../servers/fracto-data-server/handlers/orbital_data_contract.js";
import { orbital_closure_error } from "../sdk/orbitals/FractoOrbitalIdentity.js";
import { validate_landing_families } from "../sdk/orbitals/FractoOrbitalDiscovery.js";

// Opt-in application writes: one explicitly selected focal point, no migrations,
// bulk scans, cancellation experiments, destructive SQL, or source-row changes.
const verify = async () => {
  const source_id = positive_id(process.argv[2] || "55");
  const store = new OrbitalDataStore();
  const db = await open_orbital_database();
  const base = `http://127.0.0.1:${Number(process.env.FRACTO_DATA_PORT || 3002)}/orbital-data`;
  const request = async (path, body, expected = 200) => {
    const response = await fetch(`${base}${path}`, {
      ...(body === undefined
        ? {}
        : { method: "POST", body: JSON.stringify(body) }),
      headers: internal_service_headers(
        body === undefined ? {} : { "content-type": "application/json" },
      ),
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json();
    assert.equal(
      response.status,
      expected,
      `${path}: ${JSON.stringify(payload)}`,
    );
    return payload.result;
  };
  try {
    const [[migration]] = await db.execute(
      "SELECT version,checksum,applied_at FROM fracto_schema_migrations WHERE version=?",
      ["007_orbital-progressions.sql"],
    );
    const migration_bytes = await readFile(
      new URL(
        "../database/migrations/007_orbital-progressions.sql",
        import.meta.url,
      ),
    );
    assert.ok(migration, "migration 007 must already be applied");
    assert.equal(
      migration.checksum,
      createHash("sha256").update(migration_bytes).digest("hex"),
    );
    const snapshot = async () =>
      (
        await db.execute(
          "SELECT id,core_point,pattern,updated_at FROM free_bailiwicks WHERE id=?",
          [source_id],
        )
      )[0][0];
    const before = await snapshot();
    const source = await store.source(source_id);
    const settings = {
      max_period: 4,
      grid_size: 31,
      max_angle_period: 4,
      max_families: 16,
    };
    const body = {
      free_bailiwick_id: source_id,
      settings,
      request_key: `application-core-${source_id}-verification-v2`,
    };
    const started = await request("/discovery-jobs", body, 202);
    console.log(
      JSON.stringify({
        stage: "submitted",
        source_bailiwick_id: source_id,
        job_id: started.id,
      }),
    );
    let run = started;
    const deadline = Date.now() + 190000;
    while (
      ["queued", "running"].includes(run.status) &&
      Date.now() < deadline
    ) {
      await pause(250);
      run = await request(`/discovery-jobs/${run.id}`);
    }
    assert.ok(
      ["completed", "partial"].includes(run.status),
      JSON.stringify(run),
    );
    assert.equal(
      run.error_code,
      null,
      "all discovery/storage stages must finish",
    );
    assert.deepEqual(run.focal_point, {
      re: source.parameter.x,
      im: source.parameter.y,
    });
    assert.ok(run.results.length > 0);
    assert.equal(
      Object.values(run.progress.ray_outcomes).reduce((a, b) => a + b, 0),
      run.results.length,
    );
    const progressions = [];
    let ratio_count = 0,
      point_count = 0;
    for (const result of run.results) {
      const orbital = await request(`/${result.orbital_id}`);
      assert.equal(orbital.free_bailiwick_id, source_id);
      assert.equal(orbital.points.length, orbital.period);
      assert.deepEqual(
        orbital.points.map((p) => p.point_index),
        Array.from({ length: orbital.period }, (_, i) => i),
      );
      assert.ok(
        new Decimal(
          orbital_closure_error(
            source.parameter,
            orbital.points.map((p) => p.point),
          ),
        ).lte(orbital.closure_tolerance),
      );
      const ratios = orbital.points.flatMap((p) =>
        p.landing_ratios.map((r) => ({ ...r, point_index: p.point_index })),
      );
      validate_landing_families(ratios, orbital.period);
      assert.deepEqual(await store.get(orbital.orbital_id), orbital);
      point_count += orbital.points.length;
      ratio_count += ratios.length;
      progressions.push(orbital);
    }
    assert.ok(
      ratio_count > 0,
      "at least one validated landing family must be persisted",
    );
    if (source_id === "55")
      assert.ok(
        progressions.filter((o) => o.period === 1).length >= 2,
        "retain distinct same-period orbitals",
      );
    const listed = await request(
      `?focal_re=${encodeURIComponent(source.parameter.x)}&focal_im=${encodeURIComponent(source.parameter.y)}`,
    );
    for (const result of run.results)
      assert.ok(listed.some((o) => o.id === result.orbital_id));
    const [[points]] = await db.execute(
      `SELECT COUNT(*) AS n FROM orbital_progression_points p
      JOIN orbital_discovery_results r ON r.orbital_id=p.orbital_id WHERE r.run_id=?`,
      [run.id],
    );
    const [[ratios]] = await db.execute(
      `SELECT COUNT(*) AS n FROM orbital_landing_ratios p
      JOIN orbital_discovery_results r ON r.orbital_id=p.orbital_id WHERE r.run_id=?`,
      [run.id],
    );
    assert.equal(Number(points.n), point_count);
    assert.equal(Number(ratios.n), ratio_count);
    assert.equal((await request("/discovery-jobs", body, 202)).id, run.id);
    assert.deepEqual(await snapshot(), before);
    const report = {
      verified_at: new Date().toISOString(),
      storage: "application database; records retained",
      migration: migration.version,
      migration_checksum_verified: true,
      source_bailiwick_id: source_id,
      focal_point: run.focal_point,
      source_pattern: source.pattern,
      job_id: run.id,
      outcome: run.status,
      error_code: run.error_code,
      all_pipeline_stages_finished: true,
      settings: run.settings,
      orbital_count: progressions.length,
      point_count,
      landing_ratio_count: ratio_count,
      ray_outcomes: run.progress.ray_outcomes,
      idempotent_request_verified: true,
      direct_database_retrieval_verified: true,
      source_unchanged: true,
      backfill_performed: false,
      ui_changes: false,
      orbitals: progressions.map((o) => ({
        orbital_id: o.orbital_id,
        period: o.period,
        ray_status: o.ray_status,
        landing_ratio_count: o.points.reduce(
          (n, p) => n + p.landing_ratios.length,
          0,
        ),
      })),
    };
    await writeFile(
      new URL("../logs/application_orbital_verification.json", import.meta.url),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await db.end();
    await store.close();
  }
};
verify().catch((error) => {
  console.error(
    "Application orbital verification failed:",
    error.code === "ERR_ASSERTION" ? error.message : error.code || error.name,
  );
  process.exitCode = 1;
});
