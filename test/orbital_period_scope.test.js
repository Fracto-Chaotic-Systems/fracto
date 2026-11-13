import test from "node:test";
import assert from "node:assert/strict";
import { pattern_orbital_periods } from "../sdk/orbitals/FractoOrbitalPeriodScope.js";
import {
  build_denominator_catalog,
  catalog_doubling_families,
  expand_catalog_family,
} from "../sdk/orbitals/FractoDenominatorCatalog.js";
import {
  discover_representative_orbital,
  representative_ray_profile,
} from "../sdk/orbitals/FractoRepresentativeRaySolver.js";
import { discover_catalog_orbital_family } from "../sdk/orbitals/FractoCatalogOrbitalDiscovery.js";
import { discover_validated_representative_orbital } from "../sdk/orbitals/FractoLandingAssignments.js";
import {
  job_compact_profile,
  load_job_catalog,
  select_pattern_catalog,
} from "../servers/fracto-data-server/handlers/orbital_catalog_jobs.js";
import { discovery_request } from "../servers/fracto-data-server/handlers/orbital_data_contract.js";
import { family_investigation_identity } from "../servers/fracto-data-server/handlers/orbital_family_contract.js";
import {
  COMPACT_SOLVER_VERSION,
  validate_compact_family_outcome,
} from "../servers/fracto-data-server/handlers/orbital_compact_contract.js";

const catalog = build_denominator_catalog({ max_denominator: 31 });
const families = [...catalog_doubling_families(catalog)];
const family = (key) => families.find((f) => f.key === key);

test("catalog selection includes pattern divisors and optional multiples, without changing the SDK catalog", async () => {
  const bundled = await load_job_catalog(524287);
  const original = JSON.stringify(bundled);
  const base = select_pattern_catalog(bundled, 4, 1);
  assert.equal(base.family_count, 5);
  assert.deepEqual(base.allowed_angle_periods, [1, 2, 4]);
  const broader = select_pattern_catalog(bundled, 4, 2);
  assert.equal(broader.family_count, 8498);
  assert.deepEqual(
    broader.allowed_angle_periods,
    [1, 2, 4, 8, 12, 16, 20, 24, 28, 32],
  );
  assert.ok(broader.denominators.some((entry) => entry.angle_period === 8));
  assert.ok(!broader.denominators.some((entry) => entry.angle_period === 6));
  assert.equal(select_pattern_catalog(bundled, 13, 2).family_count, 381);
  assert.equal(select_pattern_catalog(bundled, 12, 2).family_count, 3595);
  assert.ok(
    !select_pattern_catalog(bundled, 12, 2).denominators.some(
      (entry) => entry.angle_period === 8,
    ),
  );
  assert.equal(
    select_pattern_catalog(bundled, 1, 2).family_count,
    bundled.family_count,
  );
  assert.equal(select_pattern_catalog(bundled, 1, 1).family_count, 1);
  assert.equal(select_pattern_catalog(bundled, 4, 0), bundled);
  assert.equal(JSON.stringify(bundled), original);
  assert.throws(
    () => select_pattern_catalog(bundled, 0, 2),
    /invalid_source_pattern/,
  );
  assert.throws(
    () => select_pattern_catalog(bundled, 4, 3),
    /invalid_pattern_angle_scope/,
  );
});

test("pattern scope contains positive divisors including one, with normalized profiles", () => {
  assert.deepEqual(pattern_orbital_periods(13), [1, 13]);
  assert.deepEqual(pattern_orbital_periods(12), [1, 2, 3, 4, 6, 12]);
  assert.deepEqual(pattern_orbital_periods(1), [1]);
  assert.deepEqual(pattern_orbital_periods(36), [1, 2, 3, 4, 6, 9, 12, 18, 36]);
  for (const invalid of [0, -1, 1.5, "13", undefined])
    assert.throws(() => pattern_orbital_periods(invalid));
  assert.deepEqual(
    representative_ray_profile({ allowed_orbital_periods: [13, 1, 13] })
      .allowed_orbital_periods,
    [1, 13],
  );
  for (const periods of [[], [0], [1.5], ["1"]])
    assert.throws(() =>
      representative_ray_profile({ allowed_orbital_periods: periods }),
    );
});

test("compatible higher-angle families still discover permitted lower-period orbitals", () => {
  const allowed_orbital_periods = pattern_orbital_periods(1);
  const result = discover_representative_orbital(
    { x: -1, y: 0 },
    family("1/3"),
    { allowed_orbital_periods },
  );
  assert.equal(result.status, "orbital_candidate");
  assert.equal(result.candidate.period, 1);
  assert.deepEqual(result.statistics.newton_periods, [1]);
  assert.equal(family("1/3").angle_period, 2);
});

test("patterns 12 and 13 discover allowed cycles using only their divisor periods", () => {
  const thirteen = expand_catalog_family({
    key: "1/8191",
    numerator: "1",
    denominator: "8191",
    period: 13,
    angle_period: 13,
    candidate_orbital_periods: [1, 13],
  });
  for (const [pattern, rayFamily, expected] of [
    [12, family("1/5"), 4],
    [13, thirteen, 13],
  ]) {
    const allowed = pattern_orbital_periods(pattern);
    const result = discover_representative_orbital({ x: 0, y: 0 }, rayFamily, {
      allowed_orbital_periods: allowed,
    });
    assert.equal(result.status, "orbital_candidate");
    assert.equal(result.candidate.period, expected);
    assert.ok(
      result.statistics.newton_periods.every((period) =>
        allowed.includes(period),
      ),
    );
  }
});

test("both solvers exclude disallowed cycles before publication and skip their Newton periods", () => {
  const options = {
    allowed_orbital_periods: pattern_orbital_periods(13),
    maximum_depth: 64,
  };
  const result = discover_representative_orbital(
    { x: 0, y: 0 },
    family("1/3"),
    options,
  );
  assert.equal(result.status, "unresolved");
  assert.equal(result.candidate, undefined);
  assert.deepEqual(result.statistics.newton_periods, [1]);
  const full = discover_catalog_orbital_family({ x: 0, y: 0 }, family("1/3"), {
    ...options,
    minimum_depth: 48,
  });
  assert.equal(full.status, "unresolved");
  assert.ok(full.refinement_attempts.every((attempt) => attempt.period === 1));
});

test("scope binds durable evidence and the persistence boundary rejects excluded candidates", () => {
  const settings = discovery_request({ free_bailiwick_id: 65 }).settings;
  assert.equal(settings.catalog_pattern_periods, 1);
  const scoped = job_compact_profile(settings, 13);
  const unscoped = job_compact_profile(
    { ...settings, catalog_pattern_periods: 0 },
    13,
  );
  const context = {
    parameter: { x: "0", y: "0" },
    family: family("1/3"),
    catalog_version: catalog.version,
    solver_version: COMPACT_SOLVER_VERSION,
    profile: scoped,
  };
  assert.notEqual(
    family_investigation_identity(context).identity_key,
    family_investigation_identity({ ...context, profile: unscoped })
      .identity_key,
  );
  const result = discover_validated_representative_orbital(
    context.parameter,
    context.family,
  );
  assert.equal(result.candidate.period, 2);
  assert.throws(
    () => validate_compact_family_outcome(context, result),
    /invalid_investigation_orbital/,
  );
});
