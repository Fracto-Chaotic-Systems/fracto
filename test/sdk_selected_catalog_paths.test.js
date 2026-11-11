import test from "node:test";
import assert from "node:assert/strict";
import {
  build_denominator_catalog,
  catalog_doubling_families,
} from "../sdk/orbitals/FractoDenominatorCatalog.js";
import { discover_validated_representative_orbital } from "../sdk/orbitals/FractoLandingAssignments.js";
import { build_orbital_trace_request } from "../sdk/orbitals/FractoOrbitalTraceRequest.js";
import { trace_known_dynamic_rays } from "../sdk/orbitals/FractoKnownDynamicRays.js";
import {
  merge_orbital_ray_cache,
  cached_orbital_rays,
} from "../sdk/orbitals/FractoOrbitalRayCache.js";

test("selected catalog cycles above period 24 generate complete paths with per-ray progress and reusable cache", async () => {
  const parameter = { x: "0", y: "0" };
  const families = [
    ...catalog_doubling_families(
      build_denominator_catalog({ max_denominator: 163 }),
    ),
  ];
  for (const denominator of [59, 163]) {
    const family = families.find((entry) => entry.key === `1/${denominator}`);
    const compact = discover_validated_representative_orbital(
      parameter,
      family,
    );
    assert.equal(compact.status, "assignments_verified", compact.reason);
    assert.deepEqual(compact.rays, [], "discovery retains no geometry");
    const orbital = {
      orbital_id: String(denominator),
      period: compact.candidate.period,
      points: compact.candidate.points.map((point, point_index) => ({
        point_index,
        point,
        landing_ratios: compact.landing_ratios.filter(
          (ratio) => ratio.point_index === point_index,
        ),
      })),
    };
    const request = build_orbital_trace_request(parameter, orbital);
    const progress = [];
    const result = await trace_known_dynamic_rays(request, {
      on_progress: (p) =>
        progress.push({
          processed: p.processed,
          total: p.total,
          ray_count: p.rays.length,
        }),
    });
    assert.equal(
      result.status,
      "rays_found",
      JSON.stringify(result.unresolved),
    );
    assert.equal(result.rays.length, family.angle_period);
    assert.ok(
      progress.some(
        (p) => p.processed > 0 && p.processed < p.total && p.ray_count === 0,
      ),
      "progress advances before the whole family is accepted",
    );
    assert.ok(
      result.rays.every(
        (ray) => ray.points.length > 2 && ray.landing_error <= 2.5e-7,
      ),
    );
    assert.equal(
      cached_orbital_rays(
        merge_orbital_ray_cache(null, request, result.rays),
        request,
      ).length,
      family.angle_period,
    );
    const incomplete = await trace_known_dynamic_rays({
      ...request,
      requests: request.requests.slice(0, -1),
    });
    assert.deepEqual(
      incomplete.rays,
      [],
      "incomplete families cannot publish partial geometry",
    );
  }
});
