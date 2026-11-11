import test from "node:test";
import assert from "node:assert/strict";
import { build_denominator_catalog } from "../sdk/orbitals/FractoDenominatorCatalog.js";
import { catalog_coverage } from "../servers/fracto-data-server/handlers/orbital_catalog_coverage.js";

const catalog = build_denominator_catalog({ max_denominator: 7 });
const report = (
  family_index,
  accepted = family_index,
  unresolved = 0,
  budget = 5,
) =>
  catalog_coverage(
    catalog,
    { family_index, accepted, unresolved, cache_hits: 0 },
    budget,
  );

test("denominator coverage distinguishes uninvestigated, partially investigated and exhausted bounds", () => {
  assert.equal(report(0).tested_through_denominator, 0);
  const partial = report(4, 3, 1, 4);
  assert.equal(partial.tested_through_denominator, 5);
  assert.equal(partial.uninvestigated_families, 1);
  assert.equal(partial.bound_exhausted, false);
  assert.deepEqual(
    partial.denominators.map((row) => row.investigated_families),
    [1, 1, 1, 1],
  );
  assert.equal(partial.denominators.at(-1).total_families, 2);
  assert.equal(report(5, 4, 1).tested_through_denominator, 7);
  assert.equal(report(5, 4, 1).bound_exhausted, true);
  assert.equal(
    report(5, 4, 1).unresolved_families,
    1,
    "exhausted is not validated",
  );
});

test("coverage preserves divisor candidates, cache counts and unresolved evidence across JSON reloads", () => {
  const details = [
    { family_key: "1/7", denominator: "7", reason: "landing_mismatch" },
  ];
  const result = JSON.parse(
    JSON.stringify(
      catalog_coverage(
        catalog,
        {
          family_index: 5,
          accepted: 4,
          unresolved: 1,
          cache_hits: 3,
          unresolved_details: details,
        },
        5,
      ),
    ),
  );
  assert.deepEqual(
    result.denominators.at(-1).candidate_orbital_periods,
    [1, 3],
  );
  assert.equal(result.cache_hits, 3);
  assert.deepEqual(result.unresolved_details, details);
});
