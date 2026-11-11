import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalog_doubling_families } from "../sdk/orbitals/FractoDenominatorCatalog.js";
import { discover_validated_representative_orbital } from "../sdk/orbitals/FractoLandingAssignments.js";
import {
  discover_representative_orbital,
  REPRESENTATIVE_CONFIRMATION_REVISION,
} from "../sdk/orbitals/FractoRepresentativeRaySolver.js";
import { validate_family_outcome } from "../servers/fracto-data-server/handlers/orbital_family_contract.js";
import { job_compact_profile } from "../servers/fracto-data-server/handlers/orbital_catalog_jobs.js";
import { COMPACT_SOLVER_VERSION } from "../servers/fracto-data-server/handlers/orbital_compact_contract.js";
const catalog = JSON.parse(
  readFileSync(
    new URL("../sdk/orbitals/data/denominator-catalog.json", import.meta.url),
  ),
);
const families = [...catalog_doubling_families(catalog)];
const keys = [
  "1/101",
  "1/107",
  "1/121",
  "1/125",
  "1/193",
  "5/193",
  "1/211",
  "1/227",
  "1/253",
  "5/253",
];
for (const key of keys)
  test(`${key} escapes the confirmation precision floor without sibling rays`, () => {
    const family = families.find((f) => f.key === key),
      profile = job_compact_profile({});
    const result = discover_validated_representative_orbital(
      { x: "0", y: "0" },
      family,
      profile,
    );
    assert.equal(result.status, "assignments_verified", result.reason);
    assert.equal(result.candidate.period, family.angle_period);
    assert.equal(
      result.confirmation_revision,
      REPRESENTATIVE_CONFIRMATION_REVISION,
    );
    assert.equal(result.statistics.traces_started, 1);
    assert.ok(result.statistics.retained_points <= 16);
    assert.ok(result.representative.depth < profile.discovery.maximum_depth);
    assert.ok(
      result.refinement_attempts.some(
        (attempt) => attempt.reason === "confirmation_precision_floor",
      ),
    );
    assert.equal(result.assignment_statistics.sibling_rays_traced, 0);
    assert.equal(result.assignment_statistics.full_family_rays_traced, 0);
    assert.deepEqual(result.rays, []);
    assert.equal(result.landing_ratios.length, family.angle_period);
    for (const ratio of result.landing_ratios) {
      const point = result.candidate.points[ratio.point_index],
        theta =
          (2 * Math.PI * Number(ratio.numerator)) / Number(ratio.denominator);
      assert.ok(
        Math.hypot(
          Number(point.re) - Math.cos(theta),
          Number(point.im) - Math.sin(theta),
        ) < 1e-12,
      );
    }
    assert.equal(
      validate_family_outcome(
        {
          parameter: { x: "0", y: "0" },
          family,
          profile,
          catalog_version: catalog.version,
          solver_version: COMPACT_SOLVER_VERSION,
        },
        result,
      ).status,
      "orbital_found",
    );
  });
test("precision ceilings and cancellation during a precision retry remain unresolved or cancelled", () => {
  const family = families.find((f) => f.key === "1/101");
  const limited = discover_representative_orbital({ x: 0, y: 0 }, family, {
    precision_digits: 64,
    maximum_precision: 64,
  });
  assert.equal(limited.status, "unresolved");
  assert.equal(limited.candidate, undefined);
  let stop = false;
  const result = discover_representative_orbital({ x: 0, y: 0 }, family, {
    cancelled: () => stop,
    on_progress: (p) => {
      if (p.precision_raises) stop = true;
    },
  });
  assert.equal(result.status, "cancelled");
  assert.equal(result.candidate, undefined);
});
