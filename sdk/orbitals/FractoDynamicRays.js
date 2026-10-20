import {
  enumerate_doubling_families,
  doubling_family_count,
  trace_ray_family,
} from "./FractoRayFamilies.js";
import { assess_ray_orbital } from "./FractoRayEligibility.js";

/** General exact angle-cycle enumeration, followed by numerical landing checks.
 * Basis: Milnor, Astérisque 261 (2000), §2/Appendix A,
 * https://numdam.org/item/AST_2000__261__277_0/ ; Benini–Lyubich,
 * AIF 64 (2014), §2, https://doi.org/10.5802/aif.2888 .
 * Distinct angle cycles need not represent distinct or attracting spatial cycles.
 */
export const find_dynamic_rays = async (parameter, orbital, options = {}) => {
  const report = options.on_progress || (() => {}),
    cancelled = options.cancelled || (() => false);
  report({ stage: "classifying", processed: 0, total: 1 });
  if (cancelled()) return { status: "cancelled", rays: [] };
  const assessment = assess_ray_orbital(parameter, orbital);
  if (assessment.status !== "ready") return { ...assessment, rays: [] };
  const c = { x: Number(parameter.x), y: Number(parameter.y) };
  const tolerance = options.tolerance ?? (3 / 550) * 0.25;
  const max_period = Math.max(
    1,
    Math.min(24, Math.floor(Number(options.max_angle_period) || 24)),
  );
  const max_families = Math.max(
    1,
    Math.min(4096, Math.floor(Number(options.max_families) || 256)),
  );
  if (assessment.period > max_period)
    return {
      ...assessment,
      status: "period_limit",
      rays: [],
      max_angle_period: max_period,
    };
  let processed = 0,
    rejected = 0,
    budget_reached = false,
    exhausted = true;
  const rays = [],
    seen = new Set(),
    periods = [];
  // A ray angle can have period r*p while its landing orbit has period p.
  for (let n = assessment.period; n <= max_period; n += assessment.period)
    periods.push(n);
  const total = Math.min(
    max_families,
    periods.reduce((sum, n) => sum + doubling_family_count(n), 0),
  );
  const publish = () =>
    report({ stage: "doubling_families", processed, total, rays: [...rays] });
  publish();
  for (const period of periods) {
    for (const family of enumerate_doubling_families(period, cancelled)) {
      if (cancelled()) return { status: "cancelled", rays: [] };
      if (processed >= max_families) {
        budget_reached = true;
        exhausted = false;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      const result = trace_ray_family(c, assessment, family, {
        tolerance,
        max_period,
        cancelled,
        align_to_orbit: true,
      });
      if (result.status === "cancelled") return result;
      processed++;
      if (result.status !== "rays_found") rejected++;
      for (const ray of result.rays)
        if (!seen.has(ray.angle.key)) {
          seen.add(ray.angle.key);
          rays.push(ray);
        }
      publish();
    }
    if (cancelled()) return { status: "cancelled", rays: [] };
    // Finish the first matching angle period, rather than searching all its multiples.
    if (rays.length || budget_reached) {
      exhausted = false;
      break;
    }
  }
  return {
    ...assessment,
    status: rays.length
      ? "rays_found"
      : budget_reached
        ? "family_limit"
        : "no_rays",
    rays,
    search: {
      strategy: "doubling_families",
      evaluations: 0,
      candidates: processed,
      rejected,
      max_angle_period: max_period,
      max_families,
      budget_reached,
      exhausted,
      complete: false,
    },
    tolerance,
  };
};
