import test from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { OrbitalDiscoveryJobs } from "../servers/fracto-data-server/handlers/orbital_data_jobs.js";
import {
  initial_checkpoint,
  encode_checkpoint,
  decode_checkpoint,
  CHECKPOINT_VERSION,
} from "../servers/fracto-data-server/handlers/orbital_data_checkpoint.js";
import {
  discovery_request,
  hash,
} from "../servers/fracto-data-server/handlers/orbital_data_contract.js";
import { build_denominator_catalog } from "../sdk/orbitals/FractoDenominatorCatalog.js";
import { discover_catalog_orbital_family } from "../sdk/orbitals/FractoCatalogOrbitalDiscovery.js";
import {
  same_orbital_cycle,
  ORBITAL_CALCULATION_VERSION,
} from "../sdk/orbitals/FractoOrbitalIdentity.js";
import { SEED_SURVEY_RAY_OPTIONS } from "../sdk/orbitals/FractoDynamicRays.js";
import { MAX_SCAN_ORBITALS } from "../sdk/orbitals/FractoSeedSurveyScan.js";
import { discover_validated_representative_orbital } from "../sdk/orbitals/FractoLandingAssignments.js";
import { validate_family_outcome } from "../servers/fracto-data-server/handlers/orbital_family_contract.js";

const roundtrip = async (cp) => decode_checkpoint(await encode_checkpoint(cp));
const settle = async (jobs) => {
  while (jobs.active.size)
    await new Promise((resolve) => setImmediate(resolve));
};
const harness = (compact = false) => {
  const catalog = build_denominator_catalog({ max_denominator: 7 });
  const settings = discovery_request({
    free_bailiwick_id: 55,
    settings: {
      catalog_max_denominator: 7,
      max_orbitals: 1,
      discovery_strategy: compact
        ? "catalog-representative-rays-v1"
        : "survey-catalog-full-rays-v1",
    },
  }).settings;
  let durable = initial_checkpoint(null, settings),
    generation = 0,
    fail_publication = false,
    cancel_at = null,
    manager;
  durable.stage = "catalog";
  const row = { id: "run", status: "interrupted" },
    cycles = [],
    ledger = new Map(),
    calls = new Map(),
    paths = new Set();
  const store = {
    claim_run: async () => {
      row.status = "queued";
      return {
        owned: true,
        token: String(++generation),
        checkpoint: await roundtrip(durable),
        source: { id: "55", parameter: { x: "0", y: "0" }, pattern: 1 },
        settings,
      };
    },
    get_run: async () => ({ ...row }),
    checkpoint: async (
      _id,
      stage,
      progress,
      status = "running",
      error_code,
      token,
    ) => {
      if (token !== String(generation) || row.status === "cancelled")
        throw Object.assign(Error("job_not_active"), {
          code: "job_not_active",
        });
      Object.assign(row, {
        stage,
        progress: structuredClone(progress),
        status,
        error_code,
      });
    },
    save_checkpoint: async (_id, cp) => {
      durable = await roundtrip(cp);
      if (cancel_at !== null && cp.catalog?.family_index === cancel_at) {
        cancel_at = null;
        await manager.cancel("run");
      }
    },
    save_orbital: async (_id, _source, candidate) => {
      let saved = cycles.find((cycle) =>
        same_orbital_cycle(cycle.points, candidate.points),
      );
      if (!saved) {
        saved = { ...candidate, id: String(cycles.length + 1) };
        cycles.push(saved);
      }
      return saved;
    },
    save_rays: async (_id, _orbital, publication) => {
      if (publication.ratios.length && fail_publication) {
        fail_publication = false;
        throw Error("publication failed");
      }
    },
    save_pending_assignments: async () => {},
    cancel: async () => {
      row.status = "cancelled";
      return { ...row };
    },
  };
  const family_store = {
    claim: async (context) =>
      ledger.has(context.family.key)
        ? {
            status: "cached",
            result: structuredClone(ledger.get(context.family.key)),
          }
        : { status: "claimed", token: context.family.key },
    complete: async (context, token, result) => {
      const checked = compact
        ? validate_family_outcome(context, result)
        : result;
      ledger.set(token, structuredClone(checked));
      return checked;
    },
    release: async () => {},
    attach_orbital: async (_context, id) => {
      if (!compact) paths.add(id);
    },
  };
  const pool = {
    run: (task, payload) => {
      assert.equal(
        task,
        compact ? "orbital_catalog_representative" : "orbital_catalog_family",
      );
      calls.set(payload.family.key, (calls.get(payload.family.key) || 0) + 1);
      return Promise.resolve(
        compact
          ? discover_validated_representative_orbital(
              payload.parameter,
              payload.family,
              {
                discovery: payload.profile.discovery,
                validation: payload.profile.validation,
              },
            )
          : discover_catalog_orbital_family(
              payload.parameter,
              payload.family,
              payload.profile,
            ),
      );
    },
    cancel() {},
    release() {},
  };
  const make = () =>
    (manager = new OrbitalDiscoveryJobs({
      store,
      pool,
      family_store,
      catalog_provider: async () => catalog,
    }));
  return {
    make,
    row,
    cycles,
    ledger,
    calls,
    paths,
    settings,
    durable: () => durable,
    fail_publication: () => {
      fail_publication = true;
    },
    cancel_at: (value) => {
      cancel_at = value;
    },
  };
};

test("catalog jobs retain all extra cycles beyond the survey limit and reuse committed families after publication failure", async () => {
  const h = harness();
  h.fail_publication();
  let jobs = h.make();
  await jobs.resume("run");
  await settle(jobs);
  assert.equal(h.row.status, "failed");
  assert.equal(h.durable().catalog, null);
  assert.equal(h.ledger.size, 1);
  assert.equal(h.calls.get("0/1"), 1);
  jobs = h.make();
  await jobs.resume("run");
  await settle(jobs);
  assert.equal(h.row.status, "completed");
  assert.equal(h.cycles.length, 5);
  assert.ok(h.cycles.length > h.settings.max_orbitals);
  assert.equal(h.paths.size, 5);
  assert.ok([...h.calls.values()].every((count) => count === 1));
  assert.equal(h.durable().stage, "done");
  assert.equal(h.durable().catalog.family_index, 5);
  assert.equal(h.row.progress.catalog_cache_hits, 1);
  assert.equal(h.row.progress.all_orbitals_discovered, false);
});

test("cancel and resume retain the catalog cursor and do not repeat completed worker families", async () => {
  const h = harness();
  h.cancel_at(2);
  let jobs = h.make();
  await jobs.resume("run");
  await settle(jobs);
  assert.equal(h.row.status, "cancelled");
  assert.equal(h.durable().catalog.family_index, 2);
  assert.equal(h.durable().progress.catalog_coverage.investigated_families, 2);
  assert.equal(
    h.durable().progress.catalog_coverage.tested_through_denominator,
    3,
  );
  assert.equal(h.durable().progress.catalog_coverage.investigated_families, 2);
  assert.equal(
    h.durable().progress.catalog_coverage.tested_through_denominator,
    3,
  );
  jobs = h.make();
  await jobs.resume("run");
  await settle(jobs);
  assert.equal(h.row.status, "completed");
  assert.equal(h.durable().catalog.family_index, 5);
  assert.equal(h.row.progress.catalog_coverage.bound_exhausted, true);
  assert.equal(h.row.progress.catalog_coverage.validated_families, 5);
  assert.equal(h.row.progress.catalog_coverage.bound_exhausted, true);
  assert.equal(h.row.progress.catalog_coverage.validated_families, 5);
  assert.ok([...h.calls.values()].every((count) => count === 1));
});

test("coverage retains unresolved family reasons and distinguishes exhausted bounds from budget limits", async () => {
  const h = harness();
  h.ledger.set("1/7", { status: "unresolved", reason: "landing_mismatch" });
  let jobs = h.make();
  await jobs.resume("run");
  await settle(jobs);
  assert.equal(h.row.status, "partial");
  const report = h.row.progress.catalog_coverage;
  assert.equal(report.bound_exhausted, true);
  assert.equal(report.validated_families, 4);
  assert.equal(report.unresolved_families, 1);
  assert.equal(report.unresolved_details[0].family_key, "1/7");
  assert.equal(report.unresolved_details[0].reason, "landing_mismatch");
  const bounded = harness();
  bounded.settings.catalog_max_families = 4;
  jobs = bounded.make();
  await jobs.resume("run");
  await settle(jobs);
  assert.equal(bounded.row.status, "partial");
  assert.equal(bounded.row.progress.catalog_coverage.bound_exhausted, false);
  assert.equal(
    bounded.row.progress.catalog_coverage.uninvestigated_families,
    1,
  );
  assert.equal(
    bounded.row.progress.catalog_coverage.tested_through_denominator,
    5,
  );
});

test("catalog-only jobs skip survey and path work, recover committed compact results, and cancel/resume", async () => {
  const h = harness(true);
  assert.equal(h.durable().version, 3);
  assert.equal(h.durable().stage, "catalog");
  h.fail_publication();
  let jobs = h.make();
  await jobs.resume("run");
  await settle(jobs);
  assert.equal(h.ledger.size, 1);
  h.cancel_at(3);
  jobs = h.make();
  await jobs.resume("run");
  await settle(jobs);
  assert.equal(h.row.status, "cancelled");
  assert.equal(h.durable().catalog.family_index, 3);
  jobs = h.make();
  await jobs.resume("run");
  await settle(jobs);
  assert.equal(h.row.status, "completed");
  assert.equal(h.cycles.length, 5);
  assert.equal(h.paths.size, 0);
  assert.ok([...h.calls.values()].every((count) => count === 1));
  assert.ok(
    [...h.ledger.values()].every((outcome) => outcome.rays.length === 0),
  );
  assert.equal(h.row.progress.catalog_coverage.validated_families, 5);
  assert.equal(h.durable().version, 3);
});

test("version-one checkpoints upgrade without discarding survey or completed ray work", async () => {
  const legacy = {
    ...initial_checkpoint(),
    version: 1,
    signature: hash([
      1,
      ORBITAL_CALCULATION_VERSION,
      SEED_SURVEY_RAY_OPTIONS,
      MAX_SCAN_ORBITALS,
    ]),
    stage: "rays",
    ray_index: 3,
    orbitals: [{ id: "4" }],
    input_hash: "original",
  };
  delete legacy.catalog;
  const decoded = await decode_checkpoint(
    await promisify(gzip)(JSON.stringify(legacy)),
  );
  assert.equal(decoded.version, CHECKPOINT_VERSION);
  assert.equal(decoded.stage, "rays");
  assert.equal(decoded.ray_index, 3);
  assert.equal(decoded.input_hash, "original");
  assert.equal(decoded.catalog, null);
});
