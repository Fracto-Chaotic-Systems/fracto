import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  build_denominator_catalog,
  validate_denominator_catalog,
  catalog_doubling_families,
  DENOMINATOR_CATALOG_VERSION,
} from "../sdk/orbitals/FractoDenominatorCatalog.js";
import { enumerate_doubling_families } from "../sdk/orbitals/FractoRayFamilies.js";

const entry = (catalog, denominator) =>
  catalog.denominators.find((item) => item.denominator === String(denominator));
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

test("catalog contains exact reduced doubling families and divisor candidates", () => {
  const catalog = build_denominator_catalog({ max_denominator: 15 });
  assert.equal(catalog.version, DENOMINATOR_CATALOG_VERSION);
  assert.equal(validate_denominator_catalog(catalog), catalog);
  assert.deepEqual(entry(catalog, 1), {
    denominator: "1",
    angle_period: 1,
    candidate_orbital_periods: [1],
    families: [{ key: "0/1", numerators: ["0"] }],
  });
  assert.deepEqual(entry(catalog, 7).families, [
    { key: "1/7", numerators: ["1", "2", "4"] },
    { key: "3/7", numerators: ["3", "6", "5"] },
  ]);
  for (const [denominator, period, candidates] of [
    [3, 2, [1, 2]],
    [5, 4, [1, 2, 4]],
    [7, 3, [1, 3]],
    [9, 6, [1, 2, 3, 6]],
    [15, 4, [1, 2, 4]],
  ]) {
    assert.equal(entry(catalog, denominator).angle_period, period);
    assert.deepEqual(
      entry(catalog, denominator).candidate_orbital_periods,
      candidates,
    );
  }
  assert.equal(entry(catalog, 2), undefined);
  assert.ok(
    entry(catalog, 15).families.every(
      (family) => !family.numerators.includes("5"),
    ),
  );
  const candidates = [
    ...catalog_doubling_families(catalog, { orbital_period: 2 }),
  ];
  assert.ok(candidates.some((family) => family.denominator === "9"));
  assert.ok(candidates.every((family) => family.period % 2 === 0));
  const seven = [...catalog_doubling_families(catalog)].find(
    (family) => family.key === "1/7",
  );
  assert.deepEqual(
    seven.angles.map((angle) => angle.key),
    ["1/7", "2/7", "4/7"],
  );
});

test("all reduced periodic fractions through 255 occur exactly once, with no period-24 cutoff", () => {
  const catalog = build_denominator_catalog();
  const actual = new Set();
  for (const family of catalog_doubling_families(catalog)) {
    let angle = BigInt(family.numerator);
    const denominator = BigInt(family.denominator);
    for (const member of family.angles) {
      assert.equal(BigInt(member.numerator), angle);
      assert.equal(member.denominator, family.denominator);
      assert.equal(actual.has(member.key), false);
      actual.add(member.key);
      angle = (2n * angle) % denominator;
    }
    assert.equal(angle, BigInt(family.numerator));
  }
  const expected = new Set(["0/1"]);
  for (let denominator = 3; denominator <= 255; denominator += 2)
    for (let numerator = 1; numerator < denominator; numerator++)
      if (gcd(numerator, denominator) === 1)
        expected.add(`${numerator}/${denominator}`);
  assert.deepEqual(actual, expected);
  assert.equal(catalog.angle_count, expected.size);
  assert.equal(
    catalog.family_count,
    [...catalog_doubling_families(catalog)].length,
  );
  assert.equal(entry(catalog, 59).angle_period, 58);
  assert.deepEqual(
    entry(catalog, 59).candidate_orbital_periods,
    [1, 2, 29, 58],
  );
  // Independent existing enumeration agrees on every cycle up to angle period 8.
  for (let period = 1; period <= 8; period++) {
    const existing = new Set(
      [...enumerate_doubling_families(period)].map(
        (family) => family.angles[0].key,
      ),
    );
    const cataloged = new Set(
      [...catalog_doubling_families(catalog)]
        .filter((family) => family.angle_period === period)
        .map((family) => family.key),
    );
    assert.deepEqual(cataloged, existing);
  }
});

test("incremental extension reuses earlier entries and matches a fresh deterministic build", () => {
  const original = build_denominator_catalog({ max_denominator: 14 });
  const snapshot = JSON.stringify(original);
  const generated = [];
  const expanded = build_denominator_catalog({
    max_denominator: 59,
    previous: original,
    on_denominator: (progress) => generated.push(progress.denominator),
  });
  assert.equal(generated[0], 15);
  assert.equal(generated.at(-1), 59);
  assert.equal(expanded.denominators[0], original.denominators[0]);
  assert.equal(JSON.stringify(original), snapshot);
  assert.deepEqual(
    expanded,
    build_denominator_catalog({ max_denominator: 59 }),
  );
  assert.equal(validate_denominator_catalog(expanded), expanded);
  assert.equal(
    build_denominator_catalog({ max_denominator: 59, previous: expanded }),
    expanded,
  );
  assert.deepEqual(
    build_denominator_catalog({ max_denominator: 60, previous: expanded }),
    build_denominator_catalog({ max_denominator: 60 }),
  );
});

test("invalid, incomplete, and excessive requests fail instead of producing partial catalogs", () => {
  for (const max_denominator of [0, -1, 1.5, NaN, Infinity, "15", 1_000_001])
    assert.throws(
      () => build_denominator_catalog({ max_denominator }),
      RangeError,
    );
  const catalog = build_denominator_catalog({ max_denominator: 15 });
  assert.throws(
    () => build_denominator_catalog({ max_denominator: 7, previous: catalog }),
    /shrink/,
  );
  assert.throws(
    () => build_denominator_catalog({ max_denominator: 255, angle_budget: 10 }),
    /requires.*budget/,
  );
  assert.throws(
    () => build_denominator_catalog({ angle_budget: Infinity }),
    /budget/,
  );
  for (const corrupt of [
    (copy) => {
      copy.version = "unknown";
    },
    (copy) => {
      copy.denominators.pop();
    },
    (copy) => {
      copy.family_count++;
    },
    (copy) => {
      entry(copy, 7).candidate_orbital_periods = [3];
    },
    (copy) => {
      entry(copy, 7).families.pop();
    },
    (copy) => {
      entry(copy, 7).families[0].numerators[1] = "3";
    },
    (copy) => {
      entry(copy, 15).families[0].numerators[0] = "5";
    },
  ]) {
    const copy = structuredClone(catalog);
    corrupt(copy);
    assert.throws(() => validate_denominator_catalog(copy));
    assert.throws(() =>
      build_denominator_catalog({ max_denominator: 31, previous: copy }),
    );
  }
  assert.throws(
    () => [...catalog_doubling_families(catalog, { orbital_period: 0 })],
    RangeError,
  );
});

const cli = fileURLToPath(
  new URL("../scripts/build_orbital_denominator_catalog.js", import.meta.url),
);
test("CLI writes, incrementally expands, verifies, and refuses to overwrite invalid catalogs", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "fracto-denominator-catalog-"),
  );
  const output = path.join(directory, "catalog.json");
  const run = (...args) =>
    JSON.parse(
      execFileSync(process.execPath, [cli, "--out", output, ...args], {
        encoding: "utf8",
      }),
    );
  try {
    const first = run("--max-denominator", "15");
    assert.equal(first.status, "written");
    const bytes = await fs.readFile(output, "utf8");
    assert.equal(run("--max-denominator", "15").status, "unchanged");
    assert.equal(await fs.readFile(output, "utf8"), bytes);
    assert.equal(run("--max-denominator", "59").status, "written");
    const expanded = JSON.parse(await fs.readFile(output, "utf8"));
    assert.deepEqual(
      expanded,
      build_denominator_catalog({ max_denominator: 59 }),
    );
    assert.equal(run("--check", "--max-denominator", "59").status, "verified");
    const shrink = spawnSync(
      process.execPath,
      [cli, "--out", output, "--max-denominator", "7"],
      { encoding: "utf8" },
    );
    assert.equal(shrink.status, 1);
    assert.match(shrink.stderr, /shrink/);
    run("--max-denominator", "257");
    assert.equal(run().status, "unchanged");
    assert.equal(run("--check").max_denominator, 257);
    await fs.writeFile(output, "invalid json");
    const invalid = spawnSync(process.execPath, [cli, "--out", output], {
      encoding: "utf8",
    });
    assert.equal(invalid.status, 1);
    assert.equal(await fs.readFile(output, "utf8"), "invalid json");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("bundled preprocessing data matches a complete fresh build", async () => {
  const bundled = JSON.parse(
    await fs.readFile(
      new URL("../sdk/orbitals/data/denominator-catalog.json", import.meta.url),
      "utf8",
    ),
  );
  validate_denominator_catalog(bundled);
  assert.ok(bundled.max_denominator >= 255);
  assert.deepEqual(bundled, build_denominator_catalog({
    max_denominator: bundled.max_denominator,
    angle_budget: bundled.angle_count,
  }));
});
