import test from "node:test";
import assert from "node:assert/strict";
import {
  build_denominator_catalog,
  catalog_doubling_families,
} from "../sdk/orbitals/FractoDenominatorCatalog.js";
import { discover_validated_representative_orbital } from "../sdk/orbitals/FractoLandingAssignments.js";
import {
  family_investigation_identity,
  validate_family_outcome,
} from "../servers/fracto-data-server/handlers/orbital_family_contract.js";
import { job_compact_profile } from "../servers/fracto-data-server/handlers/orbital_catalog_jobs.js";
import { COMPACT_SOLVER_VERSION } from "../servers/fracto-data-server/handlers/orbital_compact_contract.js";
const catalog = build_denominator_catalog({ max_denominator: 7 });
const family = [...catalog_doubling_families(catalog)].find(
  (entry) => entry.key === "1/7",
);
const profile = job_compact_profile({});
const context = {
  parameter: { x: "0", y: "0" },
  family,
  profile,
  catalog_version: catalog.version,
  solver_version: COMPACT_SOLVER_VERSION,
};
const result = discover_validated_representative_orbital(
  context.parameter,
  family,
  profile,
);

test("compact ledger identity binds algorithms and quality, excluding catalog work budgets", () => {
  const identity = family_investigation_identity(context).identity_key;
  assert.equal(
    family_investigation_identity({
      ...context,
      profile: { ...profile, max_families: 1 },
    }).identity_key,
    identity,
  );
  assert.notEqual(
    family_investigation_identity({
      ...context,
      profile: {
        ...profile,
        validation: { ...profile.validation, precision_digits: 160 },
      },
    }).identity_key,
    identity,
  );
  assert.notEqual(
    family_investigation_identity({
      ...context,
      solver_version: "catalog-orbital-discovery-v1",
      profile: {},
    }).identity_key,
    identity,
  );
  assert.throws(() =>
    family_investigation_identity({
      ...context,
      profile: { ...profile, assignment_version: "unknown" },
    }),
  );
});
test("compact evidence is rechecked after JSON storage without retracing or key-order assumptions", () => {
  assert.equal(result.status, "assignments_verified", result.reason);
  const reordered = (value) =>
    Array.isArray(value)
      ? value.map(reordered)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([k, v]) => [k, reordered(v)]),
          )
        : value;
  const checked = validate_family_outcome(
    context,
    reordered(JSON.parse(JSON.stringify(result))),
  );
  assert.equal(checked.status, "orbital_found");
  assert.deepEqual(checked.rays, []);
  assert.equal(
    validate_family_outcome(context, checked).status,
    "orbital_found",
  );
  for (const corrupt of [
    (r) =>
      (r.landing_ratios[0].point_index =
        (r.landing_ratios[0].point_index + 1) % 3),
    (r) => (r.evidence.assignment_validation.transport_endpoints[1].re = "100"),
    (r) => (r.evidence.assignment_validation.radii[0] = "100"),
    (r) => (r.evidence.assignment_validation.arc_maximum_bound = "100"),
    (r) => (r.assignment_profile.precision_digits = 64),
    (r) => (r.assignment_version = "unknown"),
    (r) => (r.rays = [{ points: [] }]),
  ]) {
    const invalid = structuredClone(result);
    corrupt(invalid);
    assert.throws(() => validate_family_outcome(context, invalid));
  }
});
test("closed candidates with unresolved assignments survive without publishing ratios", () => {
  const pending = {
    ...result,
    status: "assignments_pending",
    reason: "association_unresolved",
    landing_ratios: [],
  };
  const checked = validate_family_outcome(context, pending);
  assert.equal(checked.status, "unresolved");
  assert.equal(checked.candidate.period, 3);
  assert.deepEqual(checked.landing_ratios, []);
  assert.deepEqual(checked.rays, []);
  assert.equal(validate_family_outcome(context, checked).candidate.period, 3);
  assert.throws(() =>
    validate_family_outcome(context, {
      ...pending,
      landing_ratios: result.landing_ratios,
    }),
  );
});
