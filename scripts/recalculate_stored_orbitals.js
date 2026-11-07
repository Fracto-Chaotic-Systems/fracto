import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";
import { internal_service_headers } from "../utils/service_authorization.js";
import {
  OrbitalDataStore,
  open_orbital_database,
} from "../servers/fracto-data-server/handlers/orbital_data_store.js";
import { calculate_seed_survey } from "../servers/fracto-data-server/handlers/handle_orbital.js";
import {
  scan_orbitals,
  MAX_SCAN_ORBITALS,
  SEED_SURVEY_DISCOVERY_OPTIONS,
} from "../servers/fracto-ui/src/pages/assets/surveys/SeedSurveyScan.js";
import { same_orbital_cycle } from "../sdk/orbitals/FractoOrbitalIdentity.js";
import { validate_landing_families } from "../sdk/orbitals/FractoOrbitalDiscovery.js";

// Explicit maintenance of a frozen set of ALREADY stored focal points, never a catalog backfill.
// A persisted manifest and stable request keys permit safe resumption after interruption.
const report_path = process.argv[2] || "/tmp/fracto-stored-orbitals-100.json";
const store = new OrbitalDataStore();
const db = await open_orbital_database();
let report;
let pending_write = Promise.resolve();
const persist = () => {
  const snapshot = JSON.stringify(report, null, 2) + "\n";
  pending_write = pending_write.then(() => writeFile(report_path, snapshot));
  return pending_write;
};
const inventory = async () =>
  (
    await db.execute(`SELECT focal_key,MIN(focal_re) AS focal_re,MIN(focal_im) AS focal_im,
  MIN(free_bailiwick_id) AS source_id,COUNT(*) AS orbital_count FROM orbital_progressions GROUP BY focal_key ORDER BY MIN(id)`)
  )[0];
const source_snapshot = async (ids) =>
  (
    await db.execute(
      `SELECT id,core_point,pattern,updated_at FROM free_bailiwicks WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY id`,
      ids,
    )
  )[0];
const request = async (path, body) => {
  const response = await fetch(
    `http://127.0.0.1:${process.env.FRACTO_DATA_PORT || 3002}/orbital-data${path}`,
    {
      ...(body === undefined
        ? {}
        : { method: "POST", body: JSON.stringify(body) }),
      headers: internal_service_headers({ "content-type": "application/json" }),
      signal: AbortSignal.timeout(15000),
    },
  );
  const payload = await response.json();
  assert.ok(response.ok, `${path}: ${JSON.stringify(payload)}`);
  return payload;
};
try {
  assert.equal(MAX_SCAN_ORBITALS, 100);
  try {
    report = JSON.parse(await readFile(report_path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!report) {
    const focal_points = await inventory();
    assert.ok(focal_points.length, "no existing focal points");
    const [run_only] =
      await db.execute(`SELECT DISTINCT focal_key FROM orbital_discovery_runs
      WHERE focal_key NOT IN (SELECT focal_key FROM orbital_progressions)`);
    assert.equal(
      run_only.length,
      0,
      "review run-only focal points before freezing scope",
    );
    const [active] = await db.execute(
      "SELECT id FROM orbital_discovery_runs WHERE status IN ('queued','running')",
    );
    assert.equal(
      active.length,
      0,
      "wait for existing calculations before maintenance",
    );
    for (const focal of focal_points) {
      assert.ok(focal.source_id, "stored focal must have a source reference");
      const source = await store.source(focal.source_id);
      assert.equal(
        source.focal_key,
        focal.focal_key,
        "source core must still match stored focal",
      );
      focal.pattern = source.pattern;
    }
    const [old_headers] = await db.execute(
      "SELECT id FROM orbital_progressions ORDER BY id",
    );
    const [old_points] = await db.execute(
      "SELECT orbital_id,point_index,point_re,point_im FROM orbital_progression_points ORDER BY orbital_id,point_index",
    );
    report = {
      started_at: new Date().toISOString(),
      cap: 100,
      scope: "existing stored focal points only",
      backfill: false,
      focal_points,
      source_snapshot: await source_snapshot(
        focal_points.map((f) => f.source_id),
      ),
      old_headers,
      old_points,
      results: {},
      complete: false,
    };
    await persist();
  }
  console.log(
    JSON.stringify({
      phase: "scope",
      focal_points: report.focal_points.map((f) => ({
        source: f.source_id,
        pattern: f.pattern,
      })),
    }),
  );
  const verify = async (focal) => {
    const id = focal.source_id;
    const state = (report.results[id] ||= {});
    if (state.verified) return;
    const source = await store.source(id);
    assert.equal(source.focal_key, focal.focal_key);
    const focal_point = {
      x: Number(source.parameter.x),
      y: Number(source.parameter.y),
    };
    const settings = SEED_SURVEY_DISCOVERY_OPTIONS;
    const survey = calculate_seed_survey(focal_point, undefined, undefined, {
      ...settings,
      canvas_size: settings.grid_size,
      encoding: "rows",
    });
    const reference = await scan_orbitals(
      { ...survey, ...settings, focal_point },
      { pause: async () => {} },
    );
    assert.ok(reference.length <= 100);
    for (let i = 1; i < reference.length; i++)
      assert.ok(
        reference[i - 1].discovery_count >= reference[i].discovery_count,
      );
    state.reference_count = reference.length;
    state.request_key ||= `stored-cap100-${report.started_at.replaceAll(/[^0-9]/g, "")}-${id}`;
    await persist();
    let run = state.run_id
      ? (await request(`/discovery-jobs/${state.run_id}`)).result
      : (
          await request("/discovery-jobs", {
            free_bailiwick_id: id,
            request_key: state.request_key,
          })
        ).result;
    state.run_id = run.id;
    await persist();
    assert.equal(run.settings.max_orbitals, 100);
    assert.equal(run.focal_re, focal.focal_re);
    assert.equal(run.focal_im, focal.focal_im);
    console.log(
      JSON.stringify({
        phase: "submitted",
        source: id,
        run_id: run.id,
        reference_count: reference.length,
      }),
    );
    const deadline = Date.now() + 7250000;
    let last_log = 0;
    while (
      ["queued", "running"].includes(run.status) &&
      Date.now() < deadline
    ) {
      await pause(2000);
      run = (await request(`/discovery-jobs/${run.id}`)).result;
      if (
        Date.now() - last_log > 15000 ||
        !["queued", "running"].includes(run.status)
      ) {
        console.log(
          JSON.stringify({
            phase: "progress",
            source: id,
            status: run.status,
            stage: run.stage,
            progress: run.progress,
          }),
        );
        last_log = Date.now();
      }
    }
    state.status = run.status;
    state.error_code = run.error_code;
    state.progress = run.progress;
    await persist();
    assert.ok(
      ["completed", "partial"].includes(run.status),
      JSON.stringify(run),
    );
    assert.equal(run.error_code, null, "all worker stages must finish");
    assert.equal(run.progress.scan_complete, true);
    assert.equal(run.progress.ray_orbitals_processed, reference.length);
    const query = new URLSearchParams({
      focal_re: focal.focal_re,
      focal_im: focal.focal_im,
      view: "survey",
    });
    const listed = await request(`?${query}`);
    assert.equal(listed.run_id, run.id);
    assert.equal(listed.result.length, reference.length);
    assert.deepEqual(
      listed.result.map((h) => h.id).sort(),
      run.results.map((r) => r.orbital_id).sort(),
    );
    state.orbitals = [];
    for (const [rank, header] of listed.result.entries()) {
      const orbital = (await request(`/${header.id}`)).result;
      const expected = reference[rank];
      assert.equal(header.discovery_metadata.rank, rank);
      assert.equal(
        header.discovery_metadata.discovery_count,
        expected.discovery_count,
      );
      assert.ok(
        Math.abs(header.discovery_metadata.confidence - expected.confidence) <
          1e-14,
      );
      assert.equal(orbital.period, expected.points.length);
      assert.ok(
        same_orbital_cycle(
          orbital.points.map((p) => p.point),
          expected.precise_points,
          "1e-7",
        ),
      );
      assert.deepEqual(
        await store.get(orbital.orbital_id),
        orbital,
        "HTTP progression must match direct MySQL retrieval",
      );
      const [[membership]] = await db.execute(
        "SELECT discovery_metadata FROM orbital_discovery_results WHERE run_id=? AND orbital_id=?",
        [run.id, orbital.orbital_id],
      );
      assert.deepEqual(
        typeof membership.discovery_metadata === "string"
          ? JSON.parse(membership.discovery_metadata)
          : membership.discovery_metadata,
        header.discovery_metadata,
      );
      const ratios = orbital.points.flatMap((p) =>
        p.landing_ratios.map((r) => ({ ...r, point_index: p.point_index })),
      );
      validate_landing_families(ratios, orbital.period);
      state.orbitals.push({
        rank,
        id: orbital.orbital_id,
        period: orbital.period,
        discovery_count: header.discovery_metadata.discovery_count,
        confidence: header.discovery_metadata.confidence,
        ray_status: orbital.ray_status,
        point_count: orbital.points.length,
        ratio_count: ratios.length,
      });
    }
    state.verified = true;
    state.seconds =
      (Date.parse(run.updated_at) - Date.parse(run.created_at)) / 1000;
    await persist();
    console.log(
      JSON.stringify({
        phase: "verified",
        source: id,
        count: state.orbitals.length,
        status: state.status,
        seconds: state.seconds,
      }),
    );
  };
  let next = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(2, report.focal_points.length) },
      async () => {
        while (next < report.focal_points.length) {
          const focal = report.focal_points[next++];
          try {
            await verify(focal);
          } catch (error) {
            report.results[focal.source_id] ||= {};
            report.results[focal.source_id].verification_error = error.message;
            await persist();
            console.log(
              JSON.stringify({
                phase: "verification_error",
                source: focal.source_id,
                error: error.message,
              }),
            );
          }
        }
      },
    ),
  );
  assert.deepEqual(
    (await inventory()).map((f) => f.focal_key).sort(),
    report.focal_points.map((f) => f.focal_key).sort(),
    "no new focal points",
  );
  assert.equal(
    JSON.stringify(
      await source_snapshot(report.focal_points.map((f) => f.source_id)),
    ),
    JSON.stringify(report.source_snapshot),
    "source rows unchanged",
  );
  const [current_headers] = await db.execute(
    "SELECT id FROM orbital_progressions ORDER BY id",
  );
  const ids = new Set(current_headers.map((h) => String(h.id)));
  assert.ok(
    report.old_headers.every((h) => ids.has(String(h.id))),
    "historical orbital identities retained",
  );
  const [old_points_now] = await db.execute(
    `SELECT orbital_id,point_index,point_re,point_im FROM orbital_progression_points
    WHERE orbital_id IN (${report.old_headers.map(() => "?").join(",")}) ORDER BY orbital_id,point_index`,
    report.old_headers.map((h) => h.id),
  );
  assert.equal(
    JSON.stringify(old_points_now),
    JSON.stringify(report.old_points),
    "historical points unchanged",
  );
  assert.ok(
    report.focal_points.every((f) => report.results[f.source_id]?.verified),
    "every existing focal must pass verification",
  );
  report.complete = true;
  report.finished_at = new Date().toISOString();
  report.no_new_focal_points = true;
  report.source_rows_unchanged = true;
  report.history_preserved = true;
  await persist();
  console.log(
    JSON.stringify({
      phase: "complete",
      focal_count: report.focal_points.length,
      results: report.focal_points.map((f) => ({
        source: f.source_id,
        count: report.results[f.source_id].orbitals.length,
        status: report.results[f.source_id].status,
      })),
    }),
  );
} finally {
  await db.end();
  await store.close();
}
