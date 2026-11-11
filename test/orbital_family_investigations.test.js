import test from "node:test";
import assert from "node:assert/strict";
import {
  family_investigation_identity,
  validate_family_outcome,
} from "../servers/fracto-data-server/handlers/orbital_family_contract.js";
import {
  build_denominator_catalog,
  catalog_doubling_families,
} from "../sdk/orbitals/FractoDenominatorCatalog.js";
import {
  discover_catalog_orbitals,
  discover_catalog_orbital_family,
  catalog_discovery_profile,
  CATALOG_ORBITAL_DISCOVERY_VERSION,
} from "../sdk/orbitals/FractoCatalogOrbitalDiscovery.js";

const parameter = { x: "0", y: "0" };
const catalog = build_denominator_catalog({ max_denominator: 7 });
const profile = catalog_discovery_profile({
  tolerance: 1e-5,
  minimum_depth: 32,
  maximum_depth: 256,
  max_points: 6000,
  precision_digits: 128,
  newton_iterations: 40,
});
const family = [...catalog_doubling_families(catalog)][0];
const context = {
  parameter,
  family,
  profile,
  catalog_version: catalog.version,
  solver_version: CATALOG_ORBITAL_DISCOVERY_VERSION,
};

test("family identity survives catalog expansion and run/display changes but binds numerical settings", () => {
  const first = family_investigation_identity(context);
  const expanded = [
    ...catalog_doubling_families(
      build_denominator_catalog({ max_denominator: 59 }),
    ),
  ][0];
  assert.equal(
    family_investigation_identity({
      ...context,
      family: expanded,
      profile: { ...profile, max_families: 1, retain_geometry: true },
    }).identity_key,
    first.identity_key,
  );
  assert.notEqual(
    family_investigation_identity({
      ...context,
      profile: { ...profile, precision_digits: 256 },
    }).identity_key,
    first.identity_key,
  );
  assert.notEqual(
    family_investigation_identity({
      ...context,
      parameter: { x: "0.00000000000000000000001", y: "0" },
    }).identity_key,
    first.identity_key,
  );
  assert.throws(
    () =>
      family_investigation_identity({ ...context, solver_version: "unknown" }),
    /version/,
  );
});

test("persistence boundary rejects incomplete ratios, wrong orbital points, and corrupt geometry", () => {
  const found = discover_catalog_orbital_family(parameter, family, {
    ...profile,
    retain_geometry: true,
  });
  const checked = validate_family_outcome(context, found);
  assert.equal(checked.status, "orbital_found");
  assert.equal(checked.rays.length, 1);
  for (const corrupt of [
    (copy) => {
      copy.candidate.points[0].re = "0.5";
    },
    (copy) => {
      copy.landing_ratios = [];
    },
    (copy) => {
      copy.rays[0].endpoint.x = 0;
    },
    (copy) => {
      copy.rays[0].points[0].x = Infinity;
    },
    (copy) => {
      copy.family.catalog_key = "1/3";
    },
  ]) {
    const copy = structuredClone(found);
    corrupt(copy);
    assert.throws(() => validate_family_outcome(context, copy));
  }
  assert.throws(() =>
    validate_family_outcome(context, {
      status: "unresolved",
      reason: "failed",
      candidate: found.candidate,
    }),
  );
});

class MemoryInvestigations {
  rows = new Map();
  writes = 0;
  claims = 0;
  releases = 0;
  async claim(context, { retry_unresolved }) {
    const key = family_investigation_identity(context).identity_key;
    const result = this.rows.get(key);
    if (result && (result.status === "orbital_found" || !retry_unresolved))
      return { status: "cached", result: structuredClone(result) };
    this.claims++;
    return { status: "claimed", token: key };
  }
  async complete(context, token, result) {
    assert.equal(token, family_investigation_identity(context).identity_key);
    const checked = validate_family_outcome(context, result);
    this.rows.set(token, structuredClone(checked));
    this.writes++;
    return checked;
  }
  async release() {
    this.releases++;
  }
}

test("completed investigations survive fresh runs and expanded denominator coverage", async () => {
  const store = new MemoryInvestigations();
  const first = await discover_catalog_orbitals(parameter, {
    ...profile,
    catalog,
    investigation_store: store,
  });
  assert.equal(first.search.persistence.writes, catalog.family_count);
  assert.equal(first.candidates.length, 5);
  assert.ok(first.candidates.every((candidate) => candidate.rays.length === 0));
  assert.ok([...store.rows.values()].every((result) => result.rays.length > 0));
  const second = await discover_catalog_orbitals(parameter, {
    ...profile,
    catalog,
    investigation_store: store,
  });
  assert.equal(second.search.persistence.cache_hits, catalog.family_count);
  assert.equal(second.search.persistence.writes, 0);
  assert.deepEqual(second.candidates, first.candidates);
  const expanded = await discover_catalog_orbitals(parameter, {
    ...profile,
    catalog: build_denominator_catalog({ max_denominator: 9 }),
    investigation_store: store,
  });
  assert.equal(expanded.search.persistence.cache_hits, catalog.family_count);
  assert.equal(expanded.search.persistence.writes, 1);
  const geometry = await discover_catalog_orbitals(parameter, {
    ...profile,
    catalog,
    retain_geometry: true,
    investigation_store: store,
  });
  assert.equal(geometry.search.persistence.writes, 0);
  assert.ok(
    geometry.candidates.every((candidate) => candidate.rays.length > 0),
  );
});

test("unresolved results are retained and retried explicitly or under a new numerical profile", async () => {
  const store = new MemoryInvestigations();
  const small = build_denominator_catalog({ max_denominator: 1 });
  const run = (extra = {}) =>
    discover_catalog_orbitals(parameter, {
      ...profile,
      catalog: small,
      max_points: 16,
      investigation_store: store,
      ...extra,
    });
  const unresolved = await run();
  assert.equal(unresolved.candidates.length, 0);
  assert.equal(unresolved.unresolved[0].reason, "point_limit");
  assert.equal((await run()).search.persistence.cache_hits, 1);
  assert.equal(
    (await run({ retry_unresolved: true })).search.persistence.writes,
    1,
  );
  assert.equal((await run({ max_points: 6000 })).candidates.length, 1);
  assert.equal(store.rows.size, 2);
});

test("busy ownership and failed writes cannot advance the durable discovery cursor", async () => {
  const busy = await discover_catalog_orbitals(parameter, {
    ...profile,
    catalog,
    investigation_store: {
      claim: async () => ({ status: "busy" }),
      complete() {},
      release() {},
    },
  });
  assert.equal(busy.status, "investigation_busy");
  assert.equal(busy.state.processed, 0);
  const store = new MemoryInvestigations();
  store.complete = async () => {
    throw Error("SQL unavailable");
  };
  await assert.rejects(
    discover_catalog_orbitals(parameter, {
      ...profile,
      catalog,
      investigation_store: store,
    }),
    (error) => {
      assert.equal(error.discovery_state.processed, 0);
      assert.equal(error.discovery_state.candidates.length, 0);
      return true;
    },
  );
  assert.equal(store.releases, 1);
});
