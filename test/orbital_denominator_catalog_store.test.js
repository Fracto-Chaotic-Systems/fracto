import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  build_denominator_catalog,
  compact_denominator_entry,
  catalog_doubling_families,
  validate_denominator_catalog,
  COMPACT_CATALOG_VERSION,
} from "../sdk/orbitals/FractoDenominatorCatalog.js";
import {
  extend_database_catalog,
  export_database_catalog,
} from "../scripts/orbital_denominator_catalog_store.js";

const projection = (maximum, limit, max_angle_period) => {
  const full = build_denominator_catalog({ max_denominator: maximum });
  const denominators = full.denominators
    .filter(
      (entry) =>
        max_angle_period === undefined ||
        entry.angle_period <= max_angle_period,
    )
    .map((entry) => ({
      ...entry,
      families: entry.families
        .filter((family) => Number(family.numerators[0]) < limit)
        .map(({ key }) => ({ key })),
    }));
  return {
    version: COMPACT_CATALOG_VERSION,
    denominator_policy: "reduced_odd",
    max_denominator: maximum,
    numerator_limit: limit,
    ...(max_angle_period === undefined ? {} : { max_angle_period }),
    family_count: denominators.reduce(
      (sum, entry) => sum + entry.families.length,
      0,
    ),
    angle_count: denominators.reduce(
      (sum, entry) => sum + entry.families.length * entry.angle_period,
      0,
    ),
    denominators,
  };
};

test("compact representatives reconstruct every original family, with complete sibling angles", () => {
  const compact = projection(511, 16);
  assert.equal(validate_denominator_catalog(compact), compact);
  const full = [
    ...catalog_doubling_families(
      build_denominator_catalog({ max_denominator: 511 }),
    ),
  ];
  const selected = [...catalog_doubling_families(compact)];
  assert.deepEqual(
    selected,
    full.filter((family) => Number(family.numerator) < 16),
  );
  assert.ok(
    selected.some((family) =>
      family.angles.some((angle) => Number(angle.numerator) >= 16),
    ),
  );
  for (const mutate of [
    (c) => {
      c.denominators.pop();
    },
    (c) => {
      c.denominators[3].families.pop();
    },
    (c) => {
      c.denominators[3].families[0].key = "2/7";
    },
    (c) => {
      c.angle_count++;
    },
    (c) => {
      c.numerator_limit = 0;
    },
  ]) {
    const copy = structuredClone(compact);
    mutate(copy);
    assert.throws(() => validate_denominator_catalog(copy));
  }
});

test("period-filtered projections retain complete eligible families and reject omissions", () => {
  const compact = projection(511, 256, 32);
  validate_denominator_catalog(compact);
  const full = [
    ...catalog_doubling_families(
      build_denominator_catalog({ max_denominator: 511 }),
    ),
  ];
  assert.deepEqual(
    [...catalog_doubling_families(compact)],
    full.filter(
      (family) => family.angle_period <= 32 && Number(family.numerator) < 256,
    ),
  );
  assert.ok(!compact.denominators.some((entry) => entry.denominator === "161")); // angle period 33
  const boundary = projection(511, 256, 16);
  validate_denominator_catalog(boundary);
  assert.ok(boundary.denominators.some((entry) => entry.denominator === "257")); // includes period 16
  for (const mutate of [
    (c) => {
      c.denominators.pop();
    },
    (c) => {
      c.max_angle_period = 0;
    },
    (c) => {
      c.max_angle_period = 33;
    },
  ]) {
    const copy = structuredClone(compact);
    mutate(copy);
    assert.throws(() => validate_denominator_catalog(copy));
  }
});

test("extended denominators supply periods 13, 16 and 17 without storing member arrays", () => {
  for (const [denominator, period] of [
    [257, 16],
    [8191, 13],
    [131071, 17],
  ]) {
    const entry = compact_denominator_entry(denominator);
    assert.equal(entry.angle_period, period);
    assert.ok(entry.candidate_orbital_periods.includes(period));
    assert.deepEqual(entry.families[0], { key: `1/${denominator}` });
    assert.equal(entry.angle_count, entry.families.length * period);
  }
  assert.throws(() => compact_denominator_entry(256));
});

test("prime-factor sieve matches independent full enumeration through 2047", () => {
  const full = build_denominator_catalog({ max_denominator: 2047 });
  for (const entry of full.denominators) {
    const compact = compact_denominator_entry(Number(entry.denominator));
    assert.equal(compact.angle_period, entry.angle_period);
    assert.equal(
      compact.angle_count,
      entry.families.length * entry.angle_period,
    );
    assert.deepEqual(
      compact.families,
      entry.families.map(({ key }) => ({ key })),
    );
  }
});

test(
  "MySQL catalog migration, incremental restart, rollback, filtering, and completeness",
  {
    skip: process.env.FRACTO_DB_INTEGRATION !== "1",
  },
  async () => {
    const { open_orbital_database } =
      await import("../servers/fracto-data-server/handlers/orbital_data_database.js");
    const db = await open_orbital_database();
    const schema = `fracto_catalog_store_test_${randomUUID().replaceAll("-", "")}`;
    assert.match(schema, /^fracto_catalog_store_test_[a-f0-9]{32}$/);
    let created = false;
    try {
      await db.query(`CREATE DATABASE \`${schema}\``);
      created = true;
      await db.query(`USE \`${schema}\``);
      const migration = await readFile(
        new URL(
          "../database/migrations/017_orbital-denominator-catalog.sql",
          import.meta.url,
        ),
        "utf8",
      );
      for (let replay = 0; replay < 2; replay++)
        for (const statement of migration
          .replace(/^\s*--.*$/gm, "")
          .split(";")
          .filter((sql) => sql.trim()))
          await db.query(statement);
      assert.deepEqual(await extend_database_catalog(db, 15), {
        added_denominators: 8,
      });
      assert.deepEqual(await extend_database_catalog(db, 15), {
        added_denominators: 0,
      });
      const failing = {
        query: db.query.bind(db),
        beginTransaction: db.beginTransaction.bind(db),
        commit: db.commit.bind(db),
        rollback: db.rollback.bind(db),
        execute: async (...args) => {
          await db.execute(...args);
          throw Error("interrupted");
        },
      };
      await assert.rejects(extend_database_catalog(failing, 31), /interrupted/);
      assert.deepEqual(await extend_database_catalog(db, 31), {
        added_denominators: 8,
      });
      const exported = await export_database_catalog(db, 31, 4);
      assert.deepEqual(exported, projection(31, 4, 32));
      validate_denominator_catalog(exported);
      const limited = await export_database_catalog(db, 31, 4, 4);
      assert.deepEqual(limited, projection(31, 4, 4));
      validate_denominator_catalog(limited);
      const [[unchanged]] = await db.query(
        "SELECT SUM(family_count) AS families FROM orbital_catalog_denominators",
      );
      assert.equal(
        Number(unchanged.families),
        build_denominator_catalog({ max_denominator: 31 }).family_count,
      );
      await assert.rejects(export_database_catalog(db, 31, 4, 0), /period/);
      await assert.rejects(export_database_catalog(db, 33), /missing/);
      await db.query(
        "DELETE FROM orbital_catalog_families WHERE denominator=7 AND numerator=3",
      );
      await assert.rejects(export_database_catalog(db, 31), /Incomplete/);
      await assert.rejects(export_database_catalog(db, 31, 0), /limit/);
    } finally {
      if (created) await db.query(`DROP DATABASE \`${schema}\``);
      await db.end();
    }
  },
);
