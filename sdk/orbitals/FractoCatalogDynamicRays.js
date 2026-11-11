import {
  validate_denominator_catalog,
  catalog_doubling_families,
} from "./FractoDenominatorCatalog.js";
import { assess_ray_orbital } from "./FractoRayEligibility.js";
import { trace_ray_family } from "./FractoRayFamilies.js";
import { rational_angle, doubled_angle } from "./FractoRayGeometry.js";

const positive_limit = (value, fallback, name) => {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new RangeError(`${name} must be a positive safe integer`);
  return limit;
};

/** Check exact transport and closure of an explicitly supplied catalog family. */
export const validate_catalog_ray_family = (family) => {
  const period = family?.angle_period;
  if (
    !Number.isSafeInteger(period) ||
    period < 1 ||
    family.period !== period ||
    family.angles?.length !== period
  )
    throw Error("invalid_catalog_family");
  let angle = rational_angle(family.numerator, family.denominator);
  const first = angle.key,
    seen = new Set();
  if (family.key !== first) throw Error("invalid_catalog_family");
  for (const member of family.angles) {
    if (
      seen.has(angle.key) ||
      member.key !== angle.key ||
      member.numerator !== angle.numerator ||
      member.denominator !== angle.denominator
    )
      throw Error("invalid_catalog_family");
    seen.add(angle.key);
    angle = doubled_angle(angle);
  }
  if (angle.key !== first) throw Error("invalid_catalog_family");
  return family;
};

/** Validate and trace an explicit exact family; never truncate it at period 24. */
export const trace_catalog_ray_family = (
  c,
  assessment,
  family,
  options = {},
) => {
  validate_catalog_ray_family(family);
  const period = family.angle_period;
  if (
    !Number.isSafeInteger(assessment?.period) ||
    assessment.period < 1 ||
    period % assessment.period !== 0
  )
    return {
      status: "family_mismatch",
      reason: "period_not_divisor",
      rays: [],
    };
  const max_family_rays = positive_limit(
    options.max_family_rays,
    4096,
    "max_family_rays",
  );
  if (period > max_family_rays)
    return {
      status: "family_ray_limit",
      angle_period: period,
      max_family_rays,
      rays: [],
    };
  // Existing endpoint, approach, precision and dynamics checks still decide
  // acceptance. The exact catalog cycle supplies its own required ray count.
  return trace_ray_family(c, assessment, family, {
    ...options,
    max_period: period,
    align_to_orbit: true,
  });
};

/**
 * Find accesses to a known orbital from denominator-bounded candidates.
 * max_angle_period belongs to the legacy route and does not filter this catalog.
 * A checkpoint counts whole families; no successful family is traced twice.
 */
export const find_catalog_dynamic_rays = async (
  parameter,
  orbital,
  options = {},
) => {
  const catalog = validate_denominator_catalog(options.catalog);
  const report = options.on_progress || (() => {});
  const cancelled = options.cancelled || (() => false);
  const max_families = positive_limit(
    options.max_families,
    256,
    "max_families",
  );
  const max_family_rays = positive_limit(
    options.max_family_rays,
    4096,
    "max_family_rays",
  );
  const work_limit =
    options.max_work_units === undefined
      ? Infinity
      : positive_limit(options.max_work_units, 1, "max_work_units");
  const tolerance = options.tolerance ?? (3 / 550) * 0.25;
  const signature = JSON.stringify([
    "denominator_catalog",
    catalog.version,
    catalog.max_denominator,
    catalog.angle_count,
    catalog.family_count,
    String(parameter?.x),
    String(parameter?.y),
    orbital?.points?.map((point) => [point.x, point.y]),
    tolerance,
    max_families,
    max_family_rays,
    options.minimum_depth ?? 96,
    options.maximum_depth ?? 384,
    options.max_points ?? 6000,
    options.precision_digits ?? 128,
    options.retain_geometry !== false,
  ]);
  if (
    options.state &&
    (options.state.version !== 1 ||
      options.state.strategy !== "denominator_catalog" ||
      options.state.signature !== signature ||
      options.state.assessment?.status !== "ready")
  )
    throw Error("ray_checkpoint_mismatch");
  if (cancelled()) return { status: "cancelled", rays: [] };
  if (!options.state) report({ stage: "classifying", processed: 0, total: 1 });
  const assessment =
    options.state?.assessment || assess_ray_orbital(parameter, orbital);
  if (
    options.state &&
    (!Number.isSafeInteger(assessment.period) ||
      assessment.period < 1 ||
      assessment.points?.length !== assessment.period ||
      !Number.isFinite(assessment.multiplier?.log_modulus) ||
      assessment.multiplier.log_modulus <= 0)
  )
    throw Error("ray_checkpoint_mismatch");
  if (assessment.status !== "ready") {
    if (options.state) throw Error("ray_checkpoint_mismatch");
    return { ...assessment, rays: [] };
  }
  const eligible_families = catalog.denominators.reduce(
    (sum, entry) =>
      sum +
      (entry.candidate_orbital_periods.includes(assessment.period)
        ? entry.families.length
        : 0),
    0,
  );
  const total = Math.min(max_families, eligible_families);
  const state = options.state || {
    version: 1,
    strategy: "denominator_catalog",
    signature,
    assessment,
    processed: 0,
    rejected: 0,
    family_index: 0,
    rays: [],
    unresolved: [],
  };
  if (
    !Number.isSafeInteger(state.processed) ||
    state.processed < 0 ||
    state.processed > total ||
    state.family_index !== state.processed ||
    !Number.isSafeInteger(state.rejected) ||
    state.rejected < 0 ||
    state.rejected > state.processed ||
    !Array.isArray(state.rays) ||
    !Array.isArray(state.unresolved) ||
    state.unresolved.length !== state.rejected
  )
    throw Error("ray_checkpoint_mismatch");
  const c = { x: Number(parameter.x), y: Number(parameter.y) };
  const seen = new Set(state.rays.map((ray) => ray.angle.key));
  const publish = () =>
    report({
      stage: "catalog_families",
      processed: state.processed,
      total,
      eligible_families,
      max_denominator: catalog.max_denominator,
      rays: [...state.rays],
    });
  publish();
  const cancelled_result = () => ({
    status: "cancelled",
    rays: [],
    state,
    progress: { processed: state.processed, total, eligible_families },
  });
  let family_index = 0,
    work = 0;
  for (const family of catalog_doubling_families(catalog, {
    orbital_period: assessment.period,
  })) {
    if (family_index++ < state.family_index) continue;
    if (cancelled()) return cancelled_result();
    if (state.processed >= max_families) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (cancelled()) return cancelled_result();
    const result = trace_catalog_ray_family(c, assessment, family, {
      tolerance,
      max_family_rays,
      cancelled,
      minimum_depth: options.minimum_depth,
      maximum_depth: options.maximum_depth,
      max_points: options.max_points,
      precision_digits: options.precision_digits,
    });
    if (result.status === "cancelled") return cancelled_result();
    state.processed++;
    state.family_index = state.processed;
    if (result.status !== "rays_found") {
      state.rejected++;
      state.unresolved.push({
        family_key: family.key,
        angle_period: family.angle_period,
        reason: result.reason || result.status,
        status: result.status,
      });
    }
    for (const ray of result.rays) {
      if (seen.has(ray.angle.key)) continue;
      seen.add(ray.angle.key);
      state.rays.push(
        options.retain_geometry === false
          ? {
              angle: ray.angle,
              point_index: ray.point_index,
              landing_error: ray.landing_error,
            }
          : ray,
      );
    }
    publish();
    if (++work >= work_limit && state.processed < total)
      return {
        status: "checkpoint",
        state,
        progress: { processed: state.processed, total, eligible_families },
      };
  }
  if (cancelled()) return cancelled_result();
  const budget_reached = state.processed < eligible_families;
  return {
    ...assessment,
    status: state.rays.length
      ? "rays_found"
      : budget_reached
        ? "family_limit"
        : state.unresolved.some(
              (family) => family.reason === "family_ray_limit",
            )
          ? "family_ray_limit"
          : "no_rays",
    rays: [...state.rays],
    unresolved: [...state.unresolved],
    tolerance,
    search: {
      strategy: "denominator_catalog",
      catalog_version: catalog.version,
      max_denominator: catalog.max_denominator,
      eligible_families,
      candidates: state.processed,
      rejected: state.rejected,
      remaining_families: eligible_families - state.processed,
      max_families,
      max_family_rays,
      budget_reached,
      exhausted: !budget_reached,
      complete: false,
    },
  };
};
