import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { cpus } from "node:os";
import { catalog_doubling_families } from "../sdk/orbitals/FractoDenominatorCatalog.js";
import { discover_validated_representative_orbital } from "../sdk/orbitals/FractoLandingAssignments.js";
import { REPRESENTATIVE_CONFIRMATION_REVISION } from "../sdk/orbitals/FractoRepresentativeRaySolver.js";
const args = process.argv.slice(2);
assert.ok(
  args.every((arg) => ["--full"].includes(arg)),
  "Usage: node scripts/verify_catalog_confirmation.js [--full]",
);
const targets = new Set([
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
]);
const catalog = JSON.parse(
  await readFile(
    new URL("../sdk/orbitals/data/denominator-catalog.json", import.meta.url),
    "utf8",
  ),
);
const families = [...catalog_doubling_families(catalog)].filter(
  (f) => args.includes("--full") || targets.has(f.key),
);
const report = {
  measured_at: new Date().toISOString(),
  node: process.version,
  cpu: cpus()[0]?.model,
  parameter: { x: "0", y: "0" },
  confirmation_revision: REPRESENTATIVE_CONFIRMATION_REVISION,
  catalog_version: catalog.version,
  max_denominator: catalog.max_denominator,
  scope: args.includes("--full") ? "full" : "previously_unresolved",
  application_rows_changed: false,
  cases: [],
};
const start = performance.now();
let last = 0;
for (const family of families) {
  const begin = performance.now(),
    result = discover_validated_representative_orbital(
      report.parameter,
      family,
    );
  let maximum_error = 0;
  if (result.status === "assignments_verified") {
    assert.equal(result.candidate.period, family.angle_period);
    assert.equal(result.landing_ratios.length, family.angle_period);
    for (const ratio of result.landing_ratios) {
      const point = result.candidate.points[ratio.point_index],
        theta =
          (2 * Math.PI * Number(ratio.numerator)) / Number(ratio.denominator);
      const error = Math.hypot(
        Number(point.re) - Math.cos(theta),
        Number(point.im) - Math.sin(theta),
      );
      assert.ok(error < 1e-12);
      maximum_error = Math.max(error, maximum_error);
    }
    assert.equal(result.statistics.traces_started, 1);
    assert.ok(result.statistics.retained_points <= 16);
    assert.equal(result.assignment_statistics.sibling_rays_traced, 0);
    assert.equal(result.assignment_statistics.full_family_rays_traced, 0);
    assert.deepEqual(result.rays, []);
  }
  report.cases.push({
    key: family.key,
    angle_period: family.angle_period,
    status: result.status,
    reason: result.reason,
    ms: performance.now() - begin,
    period: result.candidate?.period,
    precision_digits: result.candidate?.precision_digits,
    depth: result.representative?.depth,
    maximum_error,
    ratios: result.landing_ratios?.length || 0,
    statistics: result.statistics,
    assignment_statistics: result.assignment_statistics,
    precision_floor_retries: result.refinement_attempts.filter(
      (a) => a.reason === "confirmation_precision_floor",
    ).length,
    bytes: Buffer.byteLength(JSON.stringify(result)),
  });
  if (performance.now() - last > 10000) {
    console.log(
      JSON.stringify({
        processed: report.cases.length,
        total: families.length,
        verified: report.cases.filter(
          (row) => row.status === "assignments_verified",
        ).length,
        last_family: family.key,
      }),
    );
    last = performance.now();
  }
}
report.total_ms = performance.now() - start;
report.verified = report.cases.filter(
  (row) => row.status === "assignments_verified",
).length;
report.unresolved = report.cases.filter(
  (row) => row.status !== "assignments_verified",
);
report.ratios = report.cases.reduce((sum, row) => sum + row.ratios, 0);
report.maximum_error = Math.max(
  ...report.cases.map((row) => row.maximum_error),
);
const output = resolve(
  args.includes("--full")
    ? "logs/catalog_confirmation_full_verification.json"
    : "logs/catalog_confirmation_repair_verification.json",
);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    output,
    verified: report.verified,
    total: families.length,
    ratios: report.ratios,
    unresolved: report.unresolved,
    total_ms: report.total_ms,
  }),
);
assert.equal(
  report.verified,
  families.length,
  "All families must verify with compact evidence",
);
