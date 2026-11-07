import {
  enumerate_doubling_families,
  doubling_family_count,
  trace_ray_family,
} from "./FractoRayFamilies.js";
import { assess_ray_orbital } from "./FractoRayEligibility.js";

/** Common high-accuracy profile for the Seed Surveys and stored-orbital views. */
export const SEED_SURVEY_RAY_OPTIONS = Object.freeze({
  tolerance: 1e-6,
  max_angle_period: 24,
  max_families: 1024,
  minimum_depth: 128,
  maximum_depth: 512,
  max_points: 16000,
  precision_digits: 256,
});

/** General exact angle-cycle enumeration, followed by numerical landing checks.
 * Basis: Milnor, Astérisque 261 (2000), §2/Appendix A,
 * https://numdam.org/item/AST_2000__261__277_0/ ; Benini–Lyubich,
 * AIF 64 (2014), §2, https://doi.org/10.5802/aif.2888 .
 * Distinct angle cycles need not represent distinct or attracting spatial cycles.
 */
export const find_dynamic_rays = async (parameter, orbital, options = {}) => {
  const report = options.on_progress || (() => {}),
    cancelled = options.cancelled || (() => false);
  if (!options.state?.assessment)
    report({ stage: "classifying", processed: 0, total: 1 });
  if (cancelled()) return { status: "cancelled", rays: [] };
  if (options.state && options.state.assessment?.status !== "ready")
    throw Error("ray_checkpoint_mismatch");
  const assessment =
    options.state?.assessment || assess_ray_orbital(parameter, orbital);
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
  const signature = JSON.stringify([
    String(parameter.x),
    String(parameter.y),
    orbital.points.map((p) => [p.x, p.y]),
    tolerance,
    max_period,
    max_families,
    options.minimum_depth ?? 96,
    options.maximum_depth ?? 384,
    options.max_points ?? 6000,
    options.precision_digits ?? 128,
    options.retain_geometry !== false,
  ]);
  const state = options.state || {
    version: 1,
    signature,
    assessment,
    processed: 0,
    rejected: 0,
    period_index: 0,
    family_index: 0,
    rays: [],
  };
  if (
    state.version !== 1 ||
    state.signature !== signature ||
    !Number.isInteger(state.processed) ||
    state.processed < 0 ||
    state.processed > max_families ||
    !Number.isInteger(state.rejected) ||
    state.rejected < 0 ||
    state.rejected > state.processed ||
    !Number.isInteger(state.period_index) ||
    state.period_index < 0 ||
    !Number.isInteger(state.family_index) ||
    state.family_index < 0 ||
    !Array.isArray(state.rays)
  )
    throw Error("ray_checkpoint_mismatch");
  const work_limit =
    options.max_work_units === undefined
      ? Infinity
      : Math.max(1, Math.min(4096, options.max_work_units));
  let work = 0;
  let processed = state.processed,
    rejected = state.rejected,
    budget_reached = false,
    exhausted = true;
  const rays = [...state.rays],
    seen = new Set(state.rays.map((ray) => ray.angle.key)),
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
  if (
    state.period_index >= periods.length ||
    state.family_index > doubling_family_count(periods[state.period_index]) ||
    state.processed !==
      periods
        .slice(0, state.period_index)
        .reduce((sum, period) => sum + doubling_family_count(period), 0) +
        state.family_index
  )
    throw Error("ray_checkpoint_mismatch");
  for (
    let period_index = state.period_index;
    period_index < periods.length;
    period_index++
  ) {
    if (period_index !== state.period_index) {
      state.period_index = period_index;
      state.family_index = 0;
    }
    const period = periods[period_index];
    let family_index = 0;
    for (const family of enumerate_doubling_families(period, cancelled)) {
      if (family_index++ < state.family_index) continue;
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
        minimum_depth: options.minimum_depth,
        maximum_depth: options.maximum_depth,
        max_points: options.max_points,
        precision_digits: options.precision_digits,
      });
      if (result.status === "cancelled") return result;
      processed++;
      if (result.status !== "rays_found") rejected++;
      for (const ray of result.rays)
        if (!seen.has(ray.angle.key)) {
          seen.add(ray.angle.key);
          rays.push(
            options.retain_geometry === false
              ? {
                  angle: ray.angle,
                  point_index: ray.point_index,
                  landing_error: ray.landing_error,
                }
              : ray,
          );
        }
      Object.assign(state, { family_index, processed, rejected, rays });
      publish();
      if (++work >= work_limit)
        return { status: "checkpoint", state, progress: { processed, total } };
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
