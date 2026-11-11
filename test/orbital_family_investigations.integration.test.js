import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

test(
  "MySQL family ledger persists outcomes, fences owners, resumes discovery, and publishes cached geometry",
  {
    skip: process.env.FRACTO_DB_INTEGRATION !== "1",
  },
  async () => {
    const { open_orbital_database } =
      await import("../servers/fracto-data-server/handlers/orbital_data_database.js");
    const {
      OrbitalFamilyInvestigationStore,
      discover_persisted_catalog_orbitals,
    } =
      await import("../servers/fracto-data-server/handlers/orbital_family_investigations.js");
    const { build_denominator_catalog, catalog_doubling_families } =
      await import("../sdk/orbitals/FractoDenominatorCatalog.js");
    const {
      catalog_discovery_profile,
      discover_catalog_orbital_family,
      CATALOG_ORBITAL_DISCOVERY_VERSION,
    } = await import("../sdk/orbitals/FractoCatalogOrbitalDiscovery.js");
    const { family_investigation_identity } =
      await import("../servers/fracto-data-server/handlers/orbital_family_contract.js");
    const { decode_ray_cache } =
      await import("../servers/fracto-data-server/handlers/minibrot_ray_codec.js");
    const { build_orbital_trace_request } =
      await import("../sdk/orbitals/FractoOrbitalTraceRequest.js");
    const { cached_orbital_rays } =
      await import("../sdk/orbitals/FractoOrbitalRayCache.js");
    const schema = `fracto_family_test_${randomUUID().replaceAll("-", "")}`;
    assert.match(schema, /^fracto_family_test_[a-f0-9]{32}$/);
    const admin = await open_orbital_database();
    let created = false,
      a,
      b;
    try {
      await admin.query(`CREATE DATABASE \`${schema}\``);
      created = true;
      a = await open_orbital_database();
      b = await open_orbital_database();
      await a.query(`USE \`${schema}\``);
      await b.query(`USE \`${schema}\``);
      await a.query(
        "CREATE TABLE orbital_progressions (id BIGINT UNSIGNED PRIMARY KEY) ENGINE=InnoDB",
      );
      const migration = await readFile(
        new URL(
          "../database/migrations/013_orbital-family-investigations.sql",
          import.meta.url,
        ),
        "utf8",
      );
      for (const statement of migration
        .split(";")
        .filter((value) => value.trim()))
        await a.query(statement);
      const owners = await readFile(
        new URL(
          "../database/migrations/014_orbital-family-job-owners.sql",
          import.meta.url,
        ),
        "utf8",
      );
      for (const statement of owners
        .replace(/^\s*--.*$/gm, "")
        .split(";")
        .filter((value) => value.trim()))
        await a.query(statement);
      await a.query(
        await readFile(
          new URL(
            "../database/migrations/015_orbital-ray-cache-chunks.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      await a.query(
        await readFile(
          new URL(
            "../database/migrations/012_orbital-ray-paths.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      const lifecycle_sql = await readFile(
        new URL(
          "../database/migrations/016_orbital-lifecycle-state.sql",
          import.meta.url,
        ),
        "utf8",
      );
      for (const statement of lifecycle_sql
        .replace(/^\s*--.*$/gm, "")
        .split(";")
        .filter((value) => value.trim()))
        await a.query(statement);
      const parameter = { x: "0", y: "0" },
        catalog = build_denominator_catalog({ max_denominator: 7 });
      const profile = catalog_discovery_profile({
        tolerance: 1e-5,
        minimum_depth: 32,
        maximum_depth: 256,
        max_points: 6000,
        precision_digits: 128,
        newton_iterations: 40,
      });
      const families = [...catalog_doubling_families(catalog)];
      const context = (index) => ({
        parameter,
        profile,
        family: families[index],
        catalog_version: catalog.version,
        solver_version: CATALOG_ORBITAL_DISCOVERY_VERSION,
      });
      const orbitals = new Map();
      const make = (db) =>
        new OrbitalFamilyInvestigationStore({
          database: { with_db: (operation) => operation(db) },
          orbital_store: { get: async (id) => orbitals.get(id) },
        });
      const first = make(a),
        second = make(b);
      await first.prepare(
        parameter,
        build_denominator_catalog({ max_denominator: 3 }),
        profile,
      );
      assert.equal((await first.get(context(0))).status, "pending");
      const claims = await Promise.all([
        first.claim(context(0)),
        second.claim(context(0)),
      ]);
      assert.deepEqual(claims.map((claim) => claim.status).sort(), [
        "busy",
        "claimed",
      ]);
      const winner = claims[0].status === "claimed" ? first : second;
      const token = claims.find((claim) => claim.status === "claimed").token;
      const found = discover_catalog_orbital_family(parameter, families[0], {
        ...profile,
        retain_geometry: true,
      });
      const corrupt = structuredClone(found);
      corrupt.rays[0].endpoint.x = 0;
      await assert.rejects(winner.complete(context(0), token, corrupt));
      await winner.heartbeat(context(0), token);
      await winner.complete(context(0), token, found);
      await winner.heartbeat(context(0), token); // queued renewal after completion
      await assert.rejects(
        winner.heartbeat(context(0), randomUUID()),
        /investigation_lease_lost/,
      );
      await winner.complete(context(0), token, found); // replay after lost acknowledgement
      assert.equal(
        (await first.claim(context(0), { retry_unresolved: true })).status,
        "cached",
      );
      assert.equal((await first.get(context(0))).attempt_count, 1);

      const old = await first.claim(context(1));
      await a.execute(
        "UPDATE orbital_family_investigations SET lease_expires_at=DATE_SUB(NOW(3),INTERVAL 1 SECOND) WHERE identity_key=?",
        [family_investigation_identity(context(1)).identity_key],
      );
      const takeover = await second.claim(context(1));
      assert.equal(takeover.status, "claimed");
      const unresolved = {
        status: "unresolved",
        reason: "precision_limit",
        refinement_attempts: [],
      };
      await assert.rejects(
        first.complete(context(1), old.token, unresolved),
        /investigation_lease_lost/,
      );
      await assert.rejects(
        first.heartbeat(context(1), old.token),
        /investigation_lease_lost/,
      );
      await first.release(context(1), old.token);
      assert.equal((await first.get(context(1))).lease_token, takeover.token);
      await second.release(context(1), takeover.token);
      assert.equal((await first.get(context(1))).status, "pending");
      const retry = await first.claim(context(1));
      await first.complete(context(1), retry.token, unresolved);
      assert.equal(
        (await second.claim(context(1))).result.reason,
        "precision_limit",
      );
      const improve = await second.claim(context(1), {
        retry_unresolved: true,
      });
      const two = discover_catalog_orbital_family(parameter, families[1], {
        ...profile,
        retain_geometry: true,
      });
      await second.complete(context(1), improve.token, two);
      assert.equal(
        (await first.complete(context(1), retry.token, unresolved)).status,
        "orbital_found",
      );
      assert.equal((await first.get(context(1))).status, "validated");
      assert.equal((await first.get(context(1))).attempt_count, 4);
      const [history] = await a.execute(
        "SELECT status,reason FROM orbital_family_investigation_attempts WHERE investigation_key=? ORDER BY started_at,id",
        [family_investigation_identity(context(1)).identity_key],
      );
      assert.equal(history.length, 4);
      assert.ok(history.some((attempt) => attempt.reason === "lease_expired"));

      const saved = await discover_persisted_catalog_orbitals(parameter, {
        ...profile,
        catalog,
        store: first,
      });
      assert.equal(saved.search.persistence.cache_hits, 2);
      assert.equal(saved.search.persistence.writes, 3);
      const reloaded = await discover_persisted_catalog_orbitals(parameter, {
        ...profile,
        catalog,
        store: second,
        retain_geometry: true,
      });
      assert.equal(reloaded.search.persistence.cache_hits, 5);
      assert.equal(reloaded.search.persistence.writes, 0);
      assert.equal(reloaded.candidates.length, 5);
      assert.ok(
        reloaded.candidates.every((candidate) => candidate.rays.length > 0),
      );
      await first.prepare(parameter, catalog, {
        ...profile,
        precision_digits: 256,
      });
      assert.equal((await first.get(context(0))).status, "validated");

      await a.query("INSERT INTO orbital_progressions (id) VALUES (42),(43)");
      orbitals.set("42", {
        orbital_id: "42",
        period: 1,
        focal_point: { re: "0", im: "0" },
        points: [
          {
            point_index: 0,
            point: found.candidate.points[0],
            landing_ratios: found.landing_ratios,
          },
        ],
      });
      assert.equal((await first.attach_orbital(context(0), "42")).paths, 1);
      const [paths] = await a.execute(
        "SELECT paths FROM orbital_ray_paths WHERE orbital_id=42",
      );
      const cache = await decode_ray_cache(paths[0].paths);
      assert.equal(
        cached_orbital_rays(
          cache,
          build_orbital_trace_request(parameter, orbitals.get("42")),
          profile,
        ).length,
        1,
      );
      orbitals.set("43", {
        orbital_id: "43",
        period: 2,
        focal_point: { re: "0", im: "0" },
        points: [...two.candidate.points].reverse().map((point, index) => ({
          point_index: index,
          point,
          landing_ratios: two.landing_ratios.filter(
            (ratio) => ratio.point_index === 1 - index,
          ),
        })),
      });
      assert.equal((await first.attach_orbital(context(1), "43")).paths, 2);
      const prior = orbitals.get("42");
      orbitals.set("42", {
        ...prior,
        identity_tolerance: "1e-7",
        points: [
          { ...prior.points[0], point: { re: "1.000000000001", im: "0" } },
        ],
      });
      assert.equal((await first.attach_orbital(context(0), "42")).paths, 1);
      orbitals.set("42", { ...prior, identity_tolerance: "1" });
      await assert.rejects(
        first.attach_orbital(context(0), "42"),
        /invalid_orbital_identity_tolerance/,
      );
      orbitals.set("42", { ...prior, focal_point: { re: "-1", im: "0" } });
      await assert.rejects(
        first.attach_orbital(context(0), "42"),
        /investigation_orbital_mismatch/,
      );
      orbitals.set("42", {
        ...prior,
        points: [{ ...prior.points[0], landing_ratios: [] }],
      });
      await assert.rejects(
        first.attach_orbital(context(0), "42"),
        /investigation_ratios_not_published/,
      );
      assert.equal((await first.get(context(0))).orbital_id, "42");
    } finally {
      await a?.end();
      await b?.end();
      if (created) await admin.query(`DROP DATABASE \`${schema}\``);
      await admin.end();
    }
  },
);
