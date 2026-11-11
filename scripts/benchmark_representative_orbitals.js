import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { cpus } from "node:os";
import { catalog_doubling_families } from "../sdk/orbitals/FractoDenominatorCatalog.js";
import { discover_representative_orbital } from "../sdk/orbitals/FractoRepresentativeRaySolver.js";
import { discover_catalog_orbital_family } from "../sdk/orbitals/FractoCatalogOrbitalDiscovery.js";
import { same_orbital_cycle } from "../sdk/orbitals/FractoOrbitalIdentity.js";
import { validate_representative_assignments } from "../sdk/orbitals/FractoLandingAssignments.js";

assert.ok(
  process.argv
    .slice(2)
    .every((arg) => ["--full-reference", "--assignments"].includes(arg)),
  "Usage: node scripts/benchmark_representative_orbitals.js [--full-reference] [--assignments]",
);
const reference = process.argv.includes("--full-reference");
const assignments = process.argv.includes("--assignments");
const catalog = JSON.parse(
  await readFile(
    new URL("../sdk/orbitals/data/denominator-catalog.json", import.meta.url),
    "utf8",
  ),
);
const families = [...catalog_doubling_families(catalog)];
const report = {
  version: 2,
  node: process.version,
  cpu: cpus()[0]?.model,
  measured_at: new Date().toISOString(),
  full_reference: reference,
  validate_assignments: assignments,
  comparison: assignments
    ? "Representative discovery plus independent numerical assignment validation is compared with full-family tracing. Ratio-to-point mappings must match, while full drawing geometry is generated only by the reference. Timings are single development-machine observations."
    : "Representative candidate discovery has pending ratio associations. The reference additionally validates all family paths; these are different work requirements, not identical guarantees.",
  cases: [],
};
for (const [name, parameter, key] of [
  ["unit_circle", { x: "0", y: "0" }, "1/7"],
  ["basilica_divisor", { x: "-1", y: "0" }, "1/3"],
  ["period_58", { x: "0", y: "0" }, "1/59"],
  [
    "former_233_family_blocker",
    { x: "-0.5629527505984927", y: "0.47148116383941135" },
    "1/163",
  ],
]) {
  console.log(JSON.stringify({ phase: "starting", name, key }));
  const family = families.find((entry) => entry.key === key);
  let start = performance.now();
  const fast = discover_representative_orbital(parameter, family);
  const representative_ms = performance.now() - start;
  assert.equal(fast.status, "orbital_candidate", fast.reason);
  assert.equal(fast.lifecycle_state.assignments, "pending");
  assert.equal(fast.rays.length, 0);
  const result = {
    name,
    parameter,
    key,
    period: fast.candidate.period,
    profile: fast.profile,
    representative_ms,
    representative_bytes: Buffer.byteLength(JSON.stringify(fast)),
    statistics: fast.statistics,
    full_family_ms: null,
    full_family_bytes: null,
    candidate_matches_full_reference: null,
  };
  let validated;
  if (assignments) {
    start = performance.now();
    validated = validate_representative_assignments(parameter, family, fast);
    result.assignment_validation_ms = performance.now() - start;
    assert.equal(validated.status, "assignments_verified", validated.reason);
    assert.equal(validated.assignment_statistics.sibling_rays_traced, 0);
    result.assigned_total_ms =
      representative_ms + result.assignment_validation_ms;
    result.validated_ratios = validated.landing_ratios.length;
    result.assigned_bytes = Buffer.byteLength(JSON.stringify(validated));
    result.assignment_statistics = validated.assignment_statistics;
  }
  if (reference) {
    start = performance.now();
    const full = discover_catalog_orbital_family(parameter, family, {
      retain_geometry: true,
    });
    result.full_family_ms = performance.now() - start;
    assert.equal(full.status, "orbital_found", full.reason);
    assert.ok(same_orbital_cycle(fast.candidate.points, full.candidate.points));
    const a = fast.candidate.points[fast.representative.point_index],
      b = full.candidate.points[full.family.representative_point_index];
    assert.ok(
      Math.hypot(Number(a.re) - Number(b.re), Number(a.im) - Number(b.im)) <
        1e-10,
    );
    result.full_family_bytes = Buffer.byteLength(JSON.stringify(full));
    result.candidate_matches_full_reference = true;
    if (validated) {
      const original = new Map(
        full.landing_ratios.map((ratio) => [
          `${ratio.numerator}/${ratio.denominator}`,
          ratio,
        ]),
      );
      for (const ratio of validated.landing_ratios) {
        const target =
          full.candidate.points[
            original.get(`${ratio.numerator}/${ratio.denominator}`).point_index
          ];
        const mapped = validated.candidate.points[ratio.point_index];
        assert.ok(
          Math.hypot(
            Number(target.re) - Number(mapped.re),
            Number(target.im) - Number(mapped.im),
          ) < 1e-10,
        );
      }
      result.assignments_match_full_reference = true;
    }
  }
  report.cases.push(result);
  console.log(JSON.stringify(result));
}
await mkdir(new URL("../logs/", import.meta.url), { recursive: true });
await writeFile(
  new URL(
    assignments
      ? "../logs/landing_assignment_benchmark.json"
      : "../logs/representative_orbital_benchmark.json",
    import.meta.url,
  ),
  JSON.stringify(report, null, 2) + "\n",
);
