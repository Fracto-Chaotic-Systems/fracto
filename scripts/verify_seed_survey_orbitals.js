import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";
import { internal_service_headers } from "../utils/service_authorization.js";
import { OrbitalDataStore } from "../servers/fracto-data-server/handlers/orbital_data_store.js";
import { calculate_seed_survey } from "../servers/fracto-data-server/handlers/handle_orbital.js";
import {
  scan_orbitals,
  SEED_SURVEY_DISCOVERY_OPTIONS,
} from "../servers/fracto-ui/src/pages/assets/surveys/SeedSurveyScan.js";
import { same_orbital_cycle } from "../sdk/orbitals/FractoOrbitalIdentity.js";
import { validate_landing_families } from "../sdk/orbitals/FractoOrbitalDiscovery.js";

// Opt-in application write for ONE core point. No bulk discovery or source changes.
const store = new OrbitalDataStore();
try {
  const source = await store.source(process.argv[2] || "65");
  const focal_point = {
    x: Number(source.parameter.x),
    y: Number(source.parameter.y),
  };
  const options = SEED_SURVEY_DISCOVERY_OPTIONS;
  const survey = calculate_seed_survey(focal_point, undefined, undefined, {
    ...options,
    canvas_size: options.grid_size,
    encoding: "rows",
  });
  const reference = await scan_orbitals(
    { ...survey, ...options, focal_point },
    { pause: async () => {} },
  );
  if (source.pattern === 7) {
    assert.ok(reference.length >= 10 && reference.length <= 100);
    assert.ok(
      reference.slice(0, 10).every((o) => o.points.length === 7 && o.confidence > 0.999999),
    );
  }
  const base = `http://127.0.0.1:${process.env.FRACTO_DATA_PORT || 3002}/orbital-data`;
  const request = async (path, body) => {
    const response = await fetch(base + path, {
      ...(body === undefined
        ? {}
        : { method: "POST", body: JSON.stringify(body) }),
      headers: internal_service_headers({
        "content-type": "application/json",
        origin:
          process.env.FRACTO_UI_ORIGIN ||
          `http://localhost:${process.env.FRACTO_UI_PORT || 3006}`,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json();
    assert.ok(response.ok, JSON.stringify(payload));
    return payload;
  };
  const started = Date.now();
  let run = process.argv[4]
    ? (await request(`/discovery-jobs/${process.argv[4]}`)).result
    : (await request(`/bailiwicks/${source.id}/discovery-jobs`, {})).result;
  assert.equal(String(run.source_bailiwick_id), source.id);
  console.log(
    JSON.stringify({
      phase: "submitted",
      source: source.id,
      pattern: source.pattern,
      job_id: run.id,
    }),
  );
  let last = "";
  while (
    ["queued", "running"].includes(run.status) &&
    Date.now() - started < 7250000
  ) {
    await pause(2000);
    run = (await request(`/discovery-jobs/${run.id}`)).result;
    const snapshot = JSON.stringify({
      status: run.status,
      stage: run.stage,
      progress: run.progress,
    });
    if (snapshot !== last) console.log(snapshot);
    last = snapshot;
  }
  assert.ok(["completed", "partial"].includes(run.status), JSON.stringify(run));
  assert.equal(run.error_code, null, "every worker stage must finish");
  assert.equal(run.progress.scan_complete, true);
  assert.equal(run.progress.ray_orbitals_processed, reference.length);
  const query = new URLSearchParams({
    focal_re: source.parameter.x,
    focal_im: source.parameter.y,
    view: "survey",
  });
  const listed = await request(`?${query}`);
  assert.equal(listed.run_id, run.id);
  assert.equal(listed.result.length, reference.length);
  let ratio_count = 0;
  const orbitals = [];
  for (const [rank, header] of listed.result.entries()) {
    const orbital = (await request(`/${header.id}`)).result;
    const expected = reference[rank];
    assert.equal(orbital.free_bailiwick_id, source.id);
    assert.equal(orbital.period, expected.points.length);
    assert.equal(header.discovery_metadata.rank, rank);
    // MySQL JSON serialization can round a binary double by one ULP.
    assert.ok(
      Math.abs(header.discovery_metadata.confidence - expected.confidence) <
        1e-14,
    );
    assert.equal(
      header.discovery_metadata.discovery_count,
      expected.discovery_count,
    );
    assert.ok(
      same_orbital_cycle(
        orbital.points.map((p) => p.point),
        expected.precise_points,
        "1e-7",
      ),
    );
    const ratios = orbital.points.flatMap((p) =>
      p.landing_ratios.map((r) => ({ ...r, point_index: p.point_index })),
    );
    validate_landing_families(ratios, orbital.period);
    ratio_count += ratios.length;
    orbitals.push({
      id: orbital.orbital_id,
      period: orbital.period,
      confidence: header.discovery_metadata.confidence,
      discoveries: header.discovery_metadata.discovery_count,
      ray_status: orbital.ray_status,
      ratios: ratios.length,
    });
  }
  const report = {
    source: source.id,
    pattern: source.pattern,
    run_id: run.id,
    status: run.status,
    seconds: (Date.parse(run.updated_at) - Date.parse(run.created_at)) / 1000,
    verification_seconds: (Date.now() - started) / 1000,
    parity: true,
    orbitals,
    ratio_count,
    settings: run.settings,
    progress: run.progress,
  };
  await writeFile(
    process.argv[3] || "/tmp/fracto-seed-survey-verification.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await store.close();
}
