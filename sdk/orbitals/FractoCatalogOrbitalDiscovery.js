import BigComplex from "../math/BigComplex.js";
import {
  validate_denominator_catalog,
  catalog_doubling_families,
} from "./FractoDenominatorCatalog.js";
import {
  validate_catalog_ray_family,
  trace_catalog_ray_family,
} from "./FractoCatalogDynamicRays.js";
import { trace_dynamic_ray } from "./FractoDynamicRayTrace.js";
import { connectedness_evidence } from "./FractoRayEligibility.js";
import { newton_big_complex } from "./FractoNewtonBigComplex.js";
import {
  canonical_orbital,
  same_orbital_cycle,
  orbital_parameter,
} from "./FractoOrbitalIdentity.js";
import { validate_landing_families } from "./FractoOrbitalDiscovery.js";
import { distance, finite } from "./FractoRayGeometry.js";

export const CATALOG_ORBITAL_DISCOVERY_OPTIONS = Object.freeze({
  tolerance: 1e-6,
  minimum_depth: 128,
  maximum_depth: 512,
  max_points: 16000,
  precision_digits: 128,
  newton_iterations: 80,
  endpoint_window: 16,
  max_families: 256,
  max_family_rays: 4096,
  max_refinement_period: 4096,
  retain_geometry: false,
});
export const CATALOG_ORBITAL_DISCOVERY_VERSION = "catalog-orbital-discovery-v1";
export const catalog_discovery_profile = (options = {}) => {
  const profile = Object.fromEntries(
    Object.entries(CATALOG_ORBITAL_DISCOVERY_OPTIONS).map(([key, value]) => [
      key,
      options[key] ?? value,
    ]),
  );
  if (
    !Number.isFinite(profile.tolerance) ||
    profile.tolerance <= 0 ||
    profile.tolerance > 0.01 ||
    typeof profile.retain_geometry !== "boolean"
  )
    throw Error("invalid_discovery_options");
  for (const key of [
    "minimum_depth",
    "maximum_depth",
    "max_points",
    "precision_digits",
    "newton_iterations",
    "endpoint_window",
    "max_families",
    "max_family_rays",
    "max_refinement_period",
  ])
    if (!Number.isSafeInteger(profile[key]) || profile[key] < 1)
      throw Error("invalid_discovery_options");
  if (
    profile.maximum_depth > 1023 ||
    profile.minimum_depth > profile.maximum_depth ||
    profile.precision_digits < 64 ||
    profile.precision_digits > 512 ||
    profile.endpoint_window < 2 ||
    profile.max_points < profile.endpoint_window ||
    profile.max_refinement_period > 4096
  )
    throw Error("invalid_discovery_options");
  return profile;
};
const known_orbitals = (parameter, inputs = []) => {
  if (!Array.isArray(inputs)) throw Error("invalid_existing_orbitals");
  return inputs.map((input) => {
    if (!input || typeof input !== "object")
      throw Error("invalid_existing_orbital");
    if (
      input.focal_point &&
      JSON.stringify(orbital_parameter(input.focal_point)) !==
        JSON.stringify(parameter)
    )
      throw Error("existing_orbital_parameter_mismatch");
    const candidate = canonical_orbital(
      parameter,
      input.points?.map((point) => point.point || point),
      input.precision_digits || 64,
    );
    if (!candidate) throw Error("invalid_existing_orbital");
    return { ...candidate, orbital_id: input.orbital_id ?? input.id ?? null };
  });
};
const nearest_point = (ray, points, precision) => {
  const seed = ray.endpoint_decimal || {
    re: ray.endpoint.x,
    im: ray.endpoint.y,
  };
  const D = new BigComplex(0, 0, precision).Decimal;
  let index = 0,
    minimum = new D(Infinity);
  points.forEach((point, row) => {
    const dx = new D(point.re).minus(seed.re),
      dy = new D(point.im).minus(seed.im);
    const squared = dx.mul(dx).plus(dy.mul(dy));
    if (squared.lt(minimum)) {
      minimum = squared;
      index = row;
    }
  });
  return { index, distance: minimum.sqrt().toNumber() };
};

const discover_family = (
  parameter,
  family,
  profile,
  connectedness,
  references,
  cancelled,
) => {
  validate_catalog_ray_family(family);
  const unresolved = (reason, extra = {}) => ({
    status: "unresolved",
    reason,
    ...extra,
  });
  if (cancelled()) return { status: "cancelled" };
  if (family.angle_period > profile.max_family_rays)
    return unresolved("family_ray_limit");
  if (family.angle_period > profile.max_refinement_period)
    return unresolved("refinement_period_limit");
  // Keep f^q of the exterior seed near its landing region before Newton begins.
  const depth = Math.max(profile.minimum_depth, family.angle_period + 40);
  if (depth > profile.maximum_depth) return unresolved("depth_limit");
  const c = { x: Number(parameter.x), y: Number(parameter.y) };
  const representative = trace_dynamic_ray(c, family.angles[0], {
    tolerance: profile.tolerance,
    minimum_potential: 2 ** -depth,
    max_points: profile.max_points,
    precision_digits: profile.precision_digits,
    verify_precision: true,
    cancelled,
  });
  if (cancelled() || representative.reason === "cancelled")
    return { status: "cancelled" };
  if (representative.reason !== "potential_limit")
    return unresolved(representative.reason);
  if (
    !finite(representative.endpoint) ||
    !representative.endpoint_decimal ||
    !Number.isFinite(representative.precision_error) ||
    representative.precision_error > profile.tolerance * 0.25
  )
    return unresolved("precision_limit");
  const landing_tolerance = Math.min(profile.tolerance * 0.25, 1e-6);
  const earlier =
    representative.points[
      Math.max(0, representative.points.length - profile.endpoint_window)
    ];
  if (distance(earlier, representative.endpoint) > landing_tolerance)
    return unresolved("endpoint_not_converged");
  const attempts = [],
    tried = [];
  let reason = "refinement_failed";
  for (let period = 1; period <= family.angle_period; period++) {
    if (family.angle_period % period) continue;
    if (cancelled()) return { status: "cancelled" };
    for (const precision_digits of new Set([
      profile.precision_digits,
      Math.min(512, profile.precision_digits * 2),
    ])) {
      if (cancelled()) return { status: "cancelled" };
      let candidate;
      try {
        const refined = newton_big_complex(
          parameter,
          profile.newton_iterations,
          period,
          {
            seed: representative.endpoint_decimal,
            precision_digits,
          },
        );
        if (!refined.closure_reached) {
          reason = "closure_failed";
          attempts.push({ period, precision_digits, reason });
          continue;
        }
        candidate = canonical_orbital(
          parameter,
          refined.point_list,
          precision_digits,
        );
      } catch {
        reason = "refinement_failed";
        attempts.push({ period, precision_digits, reason });
        continue;
      }
      if (!candidate || family.angle_period % candidate.period !== 0) {
        reason = "closure_failed";
        attempts.push({ period, precision_digits, reason });
        continue;
      }
      if (
        nearest_point(representative, candidate.points, precision_digits)
          .distance > landing_tolerance
      ) {
        reason = "branch_changed";
        attempts.push({ period, precision_digits, reason });
        continue;
      }
      if (
        tried.some((previous) =>
          same_orbital_cycle(previous.points, candidate.points),
        )
      )
        continue;
      tried.push(candidate);
      // Preserve an existing cycle's decimal coordinates and point ordering.
      const reference = references.find((previous) =>
        same_orbital_cycle(previous.points, candidate.points),
      );
      const target = reference || candidate;
      const points = target.points.map((point) => ({
        x: Number(point.re),
        y: Number(point.im),
      }));
      const log_modulus = points.reduce(
        (sum, point) => sum + Math.log(2 * Math.hypot(point.x, point.y)),
        0,
      );
      if (!(log_modulus > Math.log(1 + 1e-6))) {
        reason = log_modulus < Math.log(1 - 1e-6) ? "attracting" : "neutral";
        attempts.push({ period, precision_digits, reason });
        continue;
      }
      const initial_point_index = nearest_point(
        representative,
        target.points,
        precision_digits,
      ).index;
      const validation = trace_catalog_ray_family(
        c,
        {
          period: target.period,
          points,
          multiplier: { log_modulus },
          connectedness,
        },
        family,
        {
          ...profile,
          cancelled,
          initial_ray: representative,
          initial_point_index,
        },
      );
      if (validation.status === "cancelled") return { status: "cancelled" };
      if (validation.status !== "rays_found") {
        reason = validation.reason || validation.status;
        attempts.push({ period, precision_digits, reason });
        continue;
      }
      // Keep the established storage family identity; the catalog uses a
      // numerical minimum, while legacy landing records use lexicographic keys.
      const landing_family_key = family.angles
        .map((angle) => angle.key)
        .sort()[0];
      const landing_ratios = validation.rays.map((ray) => ({
        point_index: ray.point_index,
        numerator: ray.angle.numerator,
        denominator: ray.angle.denominator,
        family_key: landing_family_key,
        angle_period: family.angle_period,
        landing_error: ray.landing_error,
      }));
      validate_landing_families(landing_ratios, target.period, {
        max_angle_period: profile.max_family_rays,
      });
      return {
        status: "orbital_found",
        candidate: target,
        landing_ratios,
        rays: profile.retain_geometry ? validation.rays : [],
        family: {
          catalog_key: family.key,
          landing_family_key,
          angle_period: family.angle_period,
          denominator: family.denominator,
          period: target.period,
          representative_point_index: initial_point_index,
          representative_reused:
            validation.rays[0].points === representative.points,
        },
        refinement_attempts: [
          ...attempts,
          { period, precision_digits, reason: "validated" },
        ],
      };
    }
  }
  return unresolved(reason, { refinement_attempts: attempts });
};

/** Discover and validate one explicit family without a supplied spatial orbit. */
export const discover_catalog_orbital_family = (
  parameter,
  family,
  options = {},
) => {
  const exact_parameter = orbital_parameter(parameter);
  const profile = catalog_discovery_profile(options);
  const cancelled = options.cancelled || (() => false);
  if (cancelled()) return { status: "cancelled" };
  const connectedness = connectedness_evidence({
    x: Number(exact_parameter.x),
    y: Number(exact_parameter.y),
  });
  if (connectedness.status !== "connected")
    return { status: connectedness.status, connectedness };
  return discover_family(
    exact_parameter,
    family,
    profile,
    connectedness,
    known_orbitals(exact_parameter, options.existing_orbitals),
    cancelled,
  );
};

/** Denominator-ordered ray-first discovery, independent of survey rankings. */
export const discover_catalog_orbitals = async (parameter, options = {}) => {
  const exact_parameter = orbital_parameter(parameter);
  const catalog = validate_denominator_catalog(options.catalog);
  const profile = catalog_discovery_profile(options);
  const existing = known_orbitals(exact_parameter, options.existing_orbitals);
  const cancelled = options.cancelled || (() => false),
    report = options.on_progress || (() => {});
  const investigations = options.investigation_store;
  if (
    investigations &&
    ["claim", "complete", "release"].some(
      (method) => typeof investigations[method] !== "function",
    )
  )
    throw Error("invalid_investigation_store");
  if (
    options.retry_unresolved !== undefined &&
    typeof options.retry_unresolved !== "boolean"
  )
    throw Error("invalid_retry_policy");
  const work_limit = options.max_work_units ?? Infinity;
  if (
    options.max_work_units !== undefined &&
    (!Number.isSafeInteger(work_limit) || work_limit < 1)
  )
    throw Error("invalid_discovery_work_limit");
  const signature = JSON.stringify([
    CATALOG_ORBITAL_DISCOVERY_VERSION,
    exact_parameter,
    catalog.version,
    catalog.max_denominator,
    catalog.angle_count,
    catalog.family_count,
    profile,
    existing.map((candidate) => [
      candidate.orbital_id,
      candidate.points,
      candidate.precision_digits,
    ]),
    ...(investigations
      ? ["investigations-v1", !!options.retry_unresolved]
      : []),
  ]);
  if (
    options.state &&
    (options.state.version !== 1 ||
      options.state.signature !== signature ||
      options.state.connectedness?.status !== "connected")
  )
    throw Error("discovery_checkpoint_mismatch");
  if (cancelled())
    return { status: "cancelled", candidates: [], existing_matches: [] };
  const connectedness =
    options.state?.connectedness ||
    connectedness_evidence({
      x: Number(exact_parameter.x),
      y: Number(exact_parameter.y),
    });
  if (connectedness.status !== "connected")
    return {
      status: connectedness.status,
      connectedness,
      candidates: [],
      existing_matches: [],
      unresolved: [],
    };
  const state = options.state || {
    version: 1,
    signature,
    connectedness,
    processed: 0,
    family_index: 0,
    candidates: [],
    existing_matches: [],
    families: [],
    unresolved: [],
  };
  const total = Math.min(profile.max_families, catalog.family_count);
  if (investigations) {
    state.investigation_cache_hits ??= 0;
    state.investigation_writes ??= 0;
  }
  if (
    !Number.isSafeInteger(state.processed) ||
    state.processed < 0 ||
    state.processed > total ||
    state.family_index !== state.processed ||
    !Array.isArray(state.candidates) ||
    !Array.isArray(state.existing_matches) ||
    !Array.isArray(state.families) ||
    !Array.isArray(state.unresolved) ||
    state.families.length + state.unresolved.length !== state.processed
  )
    throw Error("discovery_checkpoint_mismatch");
  const progress = () => ({
    stage: "catalog_discovery",
    processed: state.processed,
    total,
    catalog_families: catalog.family_count,
    max_denominator: catalog.max_denominator,
    discovered_orbitals: state.candidates.length,
    existing_matches: state.existing_matches.length,
    accepted_families: state.families.length,
    unresolved_families: state.unresolved.length,
  });
  const interrupted = (status) => ({
    status,
    state,
    progress: progress(),
    candidates: [...state.candidates],
    existing_matches: [...state.existing_matches],
  });
  report(progress());
  let index = 0,
    work = 0;
  for (const family of catalog_doubling_families(catalog)) {
    if (index++ < state.family_index) continue;
    if (cancelled()) return interrupted("cancelled");
    if (state.processed >= total) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const references = [
      ...existing,
      ...state.candidates,
      ...state.existing_matches,
    ];
    const context = {
      parameter: exact_parameter,
      family,
      profile,
      catalog_version: catalog.version,
      solver_version: CATALOG_ORBITAL_DISCOVERY_VERSION,
    };
    let result, token;
    if (investigations) {
      const claim = await investigations.claim(context, {
        retry_unresolved: !!options.retry_unresolved,
      });
      if (claim.status === "busy") return interrupted("investigation_busy");
      if (claim.status === "cached") {
        result = claim.result;
        state.investigation_cache_hits++;
      } else if (claim.status === "claimed") token = claim.token;
      else throw Error("invalid_investigation_claim");
    }
    if (!result) {
      try {
        result = discover_family(
          exact_parameter,
          family,
          investigations ? { ...profile, retain_geometry: true } : profile,
          connectedness,
          references,
          cancelled,
        );
        if (investigations && result.status !== "cancelled") {
          result = await investigations.complete(context, token, result);
          state.investigation_writes++;
          token = null;
        }
      } catch (error) {
        if (token)
          await investigations
            .release(context, token, "investigation_failed")
            .catch(() => {});
        error.discovery_state = state;
        throw error;
      }
    }
    if (token) await investigations.release(context, token, "cancelled");
    if (result.status === "cancelled") return interrupted("cancelled");
    if (result.status === "orbital_found") {
      const match = existing.find((candidate) =>
        same_orbital_cycle(candidate.points, result.candidate.points),
      );
      const records = match ? state.existing_matches : state.candidates;
      let target = records.find((candidate) =>
        same_orbital_cycle(candidate.points, result.candidate.points),
      );
      if (!target) {
        target = {
          ...result.candidate,
          discovery_method: "catalog_ray_endpoint_newton",
          landing_ratios: [],
          families: [],
          rays: [],
        };
        records.push(target);
      }
      const known_angles = new Set(
        target.landing_ratios.map(
          (ratio) => `${ratio.numerator}/${ratio.denominator}`,
        ),
      );
      target.landing_ratios.push(
        ...result.landing_ratios.filter(
          (ratio) =>
            !known_angles.has(`${ratio.numerator}/${ratio.denominator}`),
        ),
      );
      target.families.push(result.family);
      if (profile.retain_geometry) target.rays.push(...result.rays);
      state.families.push({
        ...result.family,
        existing: !!match,
        orbital_index: records.indexOf(target),
        refinement_attempts: result.refinement_attempts,
      });
    } else
      state.unresolved.push({
        family_key: family.key,
        angle_period: family.angle_period,
        reason: result.reason || result.status,
        refinement_attempts: result.refinement_attempts || [],
      });
    state.processed++;
    state.family_index = state.processed;
    report(progress());
    if (cancelled()) return interrupted("cancelled");
    if (++work >= work_limit && state.processed < total)
      return interrupted("checkpoint");
  }
  const budget_reached = state.processed < catalog.family_count;
  return {
    status:
      state.candidates.length || state.existing_matches.length
        ? "orbitals_found"
        : budget_reached
          ? "family_limit"
          : "unresolved",
    candidates: [...state.candidates],
    existing_matches: [...state.existing_matches],
    families: [...state.families],
    unresolved: [...state.unresolved],
    connectedness,
    parameter: exact_parameter,
    search: {
      strategy: "denominator_catalog_ray_discovery",
      catalog_version: catalog.version,
      max_denominator: catalog.max_denominator,
      catalog_families: catalog.family_count,
      processed: state.processed,
      remaining_families: catalog.family_count - state.processed,
      budget_reached,
      exhausted: !budget_reached,
      complete: false,
      profile,
      ...(investigations
        ? {
            persistence: {
              cache_hits: state.investigation_cache_hits,
              writes: state.investigation_writes,
            },
          }
        : {}),
    },
  };
};
