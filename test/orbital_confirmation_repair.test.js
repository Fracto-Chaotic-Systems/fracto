import test from "node:test";
import assert from "node:assert/strict";
import {
  initial_checkpoint,
  encode_checkpoint,
  decode_checkpoint,
} from "../servers/fracto-data-server/handlers/orbital_data_checkpoint.js";
import {
  prepare_confirmation_repair,
  needs_confirmation_repair,
} from "../servers/fracto-data-server/handlers/orbital_confirmation_repair.js";
import { stale_representative_confirmation } from "../sdk/orbitals/FractoRepresentativeRaySolver.js";
const settings = {
  discovery_strategy: "catalog-representative-rays-v1",
  catalog_max_denominator: 255,
};
test("confirmation repair preserves cursor and evidence, queues only old limits, and survives serialization", async () => {
  const cp = initial_checkpoint("original", settings);
  const details = [
    { family_key: "1/101", reason: "confirmation_depth_limit" },
    { family_key: "1/107", reason: "point_limit" },
  ];
  cp.stage = "done";
  cp.catalog = {
    family_index: 412,
    accepted: 410,
    unresolved: 2,
    cache_hits: 412,
    matched_ids: ["1"],
    unresolved_details: details,
  };
  cp.orbitals = [{ id: "1" }];
  cp.progress.catalog_coverage = { unresolved_details: details };
  assert.equal(needs_confirmation_repair(settings, cp.progress), true);
  assert.equal(prepare_confirmation_repair(cp, settings), true);
  assert.equal(cp.stage, "catalog");
  assert.equal(cp.catalog.family_index, 412);
  assert.deepEqual(cp.catalog.confirmation_retry_keys, ["1/101"]);
  assert.equal(cp.catalog.accepted, 410);
  assert.equal(cp.catalog.unresolved, 2);
  const decoded = await decode_checkpoint(await encode_checkpoint(cp));
  assert.equal(
    prepare_confirmation_repair(decoded, settings),
    false,
    "resume cannot reset the repair cursor",
  );
  assert.equal(decoded.catalog.confirmation_retry_index, 0);
  assert.deepEqual(decoded.orbitals, [{ id: "1" }]);
  assert.equal(needs_confirmation_repair(settings, decoded.progress), false);
});
test("fresh bounded failures and legacy full-ray strategies do not enter an automatic retry loop", () => {
  const details = [{ family_key: "1/101", reason: "confirmation_depth_limit" }];
  assert.equal(
    needs_confirmation_repair(settings, {
      catalog_confirmation_revision: 2,
      catalog_coverage: { unresolved_details: details },
    }),
    false,
  );
  assert.equal(
    needs_confirmation_repair(
      { catalog_max_denominator: 255 },
      { catalog_coverage: { unresolved_details: details } },
    ),
    false,
  );
  assert.equal(
    stale_representative_confirmation({
      status: "unresolved",
      reason: "confirmation_depth_limit",
    }),
    true,
  );
  assert.equal(
    stale_representative_confirmation({
      status: "unresolved",
      reason: "confirmation_depth_limit",
      confirmation_revision: 2,
    }),
    false,
  );
  assert.equal(
    stale_representative_confirmation({
      status: "orbital_found",
      reason: "confirmation_depth_limit",
    }),
    false,
  );
  assert.equal(
    stale_representative_confirmation({
      status: "unresolved",
      reason: "point_limit",
    }),
    false,
  );
});
