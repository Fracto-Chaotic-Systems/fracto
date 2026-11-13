import test from "node:test";
import assert from "node:assert/strict";
import {
  discovery_request,
  hash,
} from "../servers/fracto-data-server/handlers/orbital_data_contract.js";
import {
  load_job_catalog,
  advance_catalog_job,
  job_compact_profile,
  select_pattern_catalog,
} from "../servers/fracto-data-server/handlers/orbital_catalog_jobs.js";
import { initial_checkpoint } from "../servers/fracto-data-server/handlers/orbital_data_checkpoint.js";
import { COMPACT_SOLVER_VERSION } from "../servers/fracto-data-server/handlers/orbital_compact_contract.js";
import { family_investigation_identity } from "../servers/fracto-data-server/handlers/orbital_family_contract.js";
import { catalog_doubling_families } from "../sdk/orbitals/FractoDenominatorCatalog.js";
import {
  COMPACT_CATALOG_VERSION,
  DENOMINATOR_CATALOG_VERSION,
} from "../sdk/orbitals/FractoDenominatorCatalog.js";

test("new jobs admit the entire expanded filtered catalog; historical checkpoints retain v1", async () => {
  const previous = process.env.FRACTO_ORBITAL_CATALOG_FILE;
  delete process.env.FRACTO_ORBITAL_CATALOG_FILE;
  try {
    const settings = discovery_request({ free_bailiwick_id: 65 }).settings;
    assert.equal(settings.catalog_max_denominator, 524287);
    const catalog = await load_job_catalog(settings.catalog_max_denominator);
    assert.equal(catalog.version, COMPACT_CATALOG_VERSION);
    assert.equal(catalog.max_angle_period, 32);
    assert.equal(catalog.numerator_limit, 256);
    assert.ok(catalog.family_count > 4096);
    assert.ok(settings.catalog_max_families >= catalog.family_count);
    assert.ok(
      job_compact_profile(settings).max_families >= catalog.family_count,
    );
    const legacySettings = {
      ...settings,
      catalog_max_denominator: 255,
      catalog_max_families: 1024,
      catalog_pattern_periods: 0,
    };
    const legacy = await load_job_catalog(255, {
      version: DENOMINATOR_CATALOG_VERSION,
    });
    assert.equal(legacy.family_count, 412);
    const context = {
      parameter: { x: "0", y: "0" },
      family: catalog_doubling_families(legacy).next().value,
      solver_version: COMPACT_SOLVER_VERSION,
      profile: job_compact_profile(settings),
    };
    assert.deepEqual(
      family_investigation_identity({
        ...context,
        catalog_version: COMPACT_CATALOG_VERSION,
      }),
      family_investigation_identity({
        ...context,
        catalog_version: DENOMINATOR_CATALOG_VERSION,
      }),
    );
    for (const old of [false, true]) {
      const selected = old ? legacy : select_pattern_catalog(catalog, 13, 2);
      const input = old ? legacySettings : settings;
      const cp = initial_checkpoint(null, input);
      if (old) {
        // Historical checkpoints did not store catalog_version directly.
        cp.progress.catalog_coverage = {
          catalog_version: DENOMINATOR_CATALOG_VERSION,
        };
        cp.catalog = {
          signature: hash([
            legacy.version,
            255,
            legacy.family_count,
            COMPACT_SOLVER_VERSION,
            job_compact_profile(input),
          ]),
          family_index: 0,
          finalize_index: 0,
          matched_ids: [],
          accepted: 0,
          unresolved: 0,
          cache_hits: 0,
          unresolved_details: [],
        };
      }
      const state = { progress: cp.progress, token: "test" };
      let claimed;
      const jobs = {
        catalog_provider: load_job_catalog,
        store: { checkpoint: async () => {} },
        family_store: {
          claim: async (context) => {
            claimed = context;
            throw Error("stop before numerical work");
          },
        },
      };
      await assert.rejects(
        advance_catalog_job(
          jobs,
          "run",
          { parameter: { x: "0", y: "0" }, pattern: 13 },
          input,
          state,
          cp,
        ),
        /stop before numerical work/,
      );
      assert.equal(state.progress.catalog_total, selected.family_count);
      if (!old) {
        assert.equal(state.progress.catalog_total, 381);
        assert.deepEqual(state.progress.allowed_angle_periods, [1, 13, 26]);
        assert.equal(
          state.progress.catalog_unfiltered_families,
          catalog.family_count,
        );
      }
      assert.equal(claimed.catalog_version, selected.version);
      if (!old) {
        await assert.rejects(
          advance_catalog_job(
            jobs,
            "run",
            { parameter: { x: "0", y: "0" }, pattern: 13 },
            { ...input, catalog_pattern_angles: 1 },
            { progress: cp.progress, token: "test" },
            cp,
          ),
          /checkpoint_version_mismatch/,
        );
      }
      assert.deepEqual(
        claimed.profile.discovery.allowed_orbital_periods,
        old ? undefined : [1, 13],
      );
      assert.equal(
        state.progress.catalog_coverage.max_angle_period,
        old ? undefined : 32,
      );
    }
  } finally {
    if (previous === undefined) delete process.env.FRACTO_ORBITAL_CATALOG_FILE;
    else process.env.FRACTO_ORBITAL_CATALOG_FILE = previous;
  }
});
