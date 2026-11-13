import BigComplex from "../math/BigComplex.js";
import {
  orbital_period_profile,
  orbital_period_allowed,
} from "./FractoOrbitalPeriodScope.js";
import { create_dynamic_ray_tracer } from "./FractoDynamicRayTrace.js";
import { validate_catalog_ray_family } from "./FractoCatalogDynamicRays.js";
import { newton_big_complex } from "./FractoNewtonBigComplex.js";
import {
  canonical_orbital,
  orbital_parameter,
  same_orbital_cycle,
} from "./FractoOrbitalIdentity.js";
import { connectedness_evidence } from "./FractoRayEligibility.js";
import {
  catalog_only_strategy,
  normalize_orbital_lifecycle,
} from "./FractoOrbitalLifecycle.js";

export const REPRESENTATIVE_RAY_SOLVER_VERSION =
  catalog_only_strategy.solver_version;
// Numerical repair revision; validated v1 evidence and resumable job identities
// remain compatible. Only failures from the older confirmation code need retry.
export const REPRESENTATIVE_CONFIRMATION_REVISION = 2;
export const stale_representative_confirmation = (result) =>
  result?.status === "unresolved" &&
  result.reason === "confirmation_depth_limit" &&
  (result.confirmation_revision ?? 1) < REPRESENTATIVE_CONFIRMATION_REVISION;
export const REPRESENTATIVE_RAY_OPTIONS = Object.freeze({
  initial_depth: 12,
  depth_step: 16,
  maximum_depth: 512,
  trace_tolerance: 1e-4,
  landing_tolerance: 1e-8,
  max_points: 16000,
  endpoint_window: 16,
  minimum_precision: 64,
  precision_digits: 128,
  maximum_precision: 512,
  probe_iterations: 16,
  newton_iterations: 80,
  max_refinement_period: 4096,
});
export const representative_ray_profile = (options = {}) => {
  const profile = Object.fromEntries(
    Object.entries(REPRESENTATIVE_RAY_OPTIONS).map(([key, value]) => [
      key,
      options[key] ?? value,
    ]),
  );
  for (const [key, value] of Object.entries(profile)) {
    if (
      !Number.isFinite(value) ||
      value <= 0 ||
      (!["trace_tolerance", "landing_tolerance"].includes(key) &&
        !Number.isSafeInteger(value))
    )
      throw Error("invalid_representative_profile");
  }
  if (
    profile.initial_depth < 8 ||
    profile.maximum_depth > 1020 ||
    profile.initial_depth >= profile.maximum_depth ||
    profile.depth_step > 128 ||
    profile.trace_tolerance > 0.01 ||
    profile.landing_tolerance > 1e-6 ||
    profile.minimum_precision < 64 ||
    profile.minimum_precision > profile.precision_digits ||
    profile.maximum_precision < profile.precision_digits ||
    profile.maximum_precision > 512 ||
    profile.endpoint_window < 2 ||
    profile.max_points < profile.endpoint_window ||
    profile.max_points > 16000 ||
    profile.probe_iterations > profile.newton_iterations ||
    profile.newton_iterations > 100 ||
    profile.max_refinement_period > 4096
  )
    throw Error("invalid_representative_profile");
  return { ...profile, ...orbital_period_profile(options) };
};

const decimal_distance = (a, b, precision) => {
  const D = new BigComplex(0, 0, precision).Decimal;
  return new D(a.re)
    .minus(b.re)
    .pow(2)
    .plus(new D(a.im).minus(b.im).pow(2))
    .sqrt()
    .toNumber();
};
const nearest = (endpoint, candidate, precision) => {
  const distances = candidate.points.map((point) =>
    decimal_distance(endpoint, point, precision),
  );
  const distance = Math.min(...distances);
  return { point_index: distances.indexOf(distance), distance };
};
const multiplier_log = (candidate) =>
  candidate.points.reduce(
    (sum, point) =>
      sum + Math.log(2 * Math.hypot(Number(point.re), Number(point.im))),
    0,
  );

/** Find a closed boundary-orbit candidate using ONE continuing ray.
 * Ratio assignments deliberately remain pending: approach consistency is
 * numerical evidence, not a proof of the external ray's landing association.
 * No sibling rays or renderer geometry are generated or returned.
 */
export const discover_representative_orbital = (
  parameter,
  input_family,
  options = {},
) => {
  const exact = orbital_parameter(parameter),
    family = validate_catalog_ray_family(input_family);
  const profile = representative_ray_profile(options),
    cancelled = options.cancelled || (() => false);
  if (
    (options.cancelled !== undefined &&
      typeof options.cancelled !== "function") ||
    (options.on_progress !== undefined &&
      typeof options.on_progress !== "function")
  )
    throw Error("invalid_representative_callbacks");
  const statistics = {
    traces_started: 0,
    depth_probes: 0,
    precision_raises: 0,
    newton_attempts: 0,
    newton_periods: [],
    sample_count: 0,
    retained_points: 0,
  };
  const refinement_attempts = [];
  const base = {
    solver_version: REPRESENTATIVE_RAY_SOLVER_VERSION,
    confirmation_revision: REPRESENTATIVE_CONFIRMATION_REVISION,
    discovery_strategy: catalog_only_strategy.id,
    parameter: exact,
    profile,
    statistics,
    refinement_attempts,
  };
  const unresolved = (reason) => ({
    ...base,
    status: cancelled() ? "cancelled" : "unresolved",
    reason,
  });
  if (cancelled()) return { ...base, status: "cancelled" };
  if (family.angle_period > profile.max_refinement_period)
    return unresolved("refinement_period_limit");
  const c = { x: Number(exact.x), y: Number(exact.y) },
    connectedness = connectedness_evidence(c);
  if (cancelled()) return { ...base, status: "cancelled" };
  if (connectedness.status !== "connected")
    return { ...base, status: connectedness.status, connectedness };
  // f^q amplifies exterior potential by 2^q. Preserve enough significant digits
  // for high-period root seeds and 24-digit independent forward closure checks.
  const required_precision = Math.max(
    profile.minimum_precision,
    Math.ceil((family.angle_period + 96) / Math.log2(10)),
  );
  if (required_precision > profile.maximum_precision)
    return unresolved("precision_limit");
  let precision = Math.min(
    profile.maximum_precision,
    [64, 128, 256, 512].find((digits) => digits >= required_precision),
  );
  const tracer = create_dynamic_ray_tracer(c, family.angles[0], {
    tolerance: profile.trace_tolerance,
    max_points: profile.max_points,
    retain_geometry: false,
    endpoint_window: profile.endpoint_window,
    exact_parameter: exact,
    cancelled,
  });
  statistics.traces_started = 1;
  let depth = 0,
    ray,
    reason = "refinement_failed";
  const probe = (next_depth, digits = precision) => {
    depth = next_depth;
    ray = tracer.advance(2 ** -depth, {
      verify_precision: true,
      precision_digits: digits,
    });
    statistics.depth_probes++;
    statistics.sample_count = ray.sample_count;
    statistics.retained_points = ray.points.length;
    options.on_progress?.({
      stage: "representative",
      depth,
      precision_digits: digits,
      ...statistics,
    });
    return (
      ray.reason === "potential_limit" &&
      ray.endpoint_decimal &&
      Number.isFinite(ray.precision_error)
    );
  };
  const refine = (period, seed, digits, iterations) => {
    statistics.newton_attempts++;
    if (!statistics.newton_periods.includes(period))
      statistics.newton_periods.push(period);
    try {
      const result = newton_big_complex(exact, iterations, period, {
        seed,
        precision_digits: digits,
        cancelled,
      });
      if (result.status === "cancelled" || cancelled()) return null;
      const candidate =
        result.closure_reached &&
        canonical_orbital(exact, result.point_list, digits);
      return candidate &&
        family.angle_period % candidate.period === 0 &&
        orbital_period_allowed(profile, candidate.period)
        ? candidate
        : null;
    } catch {
      return null;
    }
  };
  probe(profile.initial_depth);
  discovery: while (true) {
    if (cancelled()) return { ...base, status: "cancelled" };
    if (!ray.endpoint_decimal || ray.reason !== "potential_limit") {
      if (
        ray.reason === "precision_limit" &&
        precision < profile.maximum_precision
      ) {
        precision = Math.min(profile.maximum_precision, precision * 2);
        statistics.precision_raises++;
        if (probe(depth)) continue;
      }
      return unresolved(ray.reason || "precision_limit");
    }
    const periods = [];
    // Full return first once its exterior seed is safe; canonicalization reduces
    // true repeated traversals. Before then, cheap proper divisors may suffice.
    if (family.angle_period + 8 <= depth) periods.push(family.angle_period);
    for (let period = 1; period < family.angle_period; period++)
      if (family.angle_period % period === 0 && period + 8 <= depth)
        periods.push(period);
    for (const period of periods) {
      if (!orbital_period_allowed(profile, period)) continue;
      if (cancelled()) return { ...base, status: "cancelled" };
      const candidate = refine(
        period,
        ray.endpoint_decimal,
        precision,
        profile.probe_iterations,
      );
      if (!candidate) {
        reason = "closure_failed";
        continue;
      }
      const log = multiplier_log(candidate);
      if (!(log > Math.log(1 + 1e-6))) {
        reason = log < Math.log(1 - 1e-6) ? "attracting" : "neutral";
        continue;
      }
      const first = nearest(ray.endpoint_decimal, candidate, precision);
      if (first.distance > profile.landing_tolerance) {
        reason = "landing_mismatch";
        continue;
      }
      if (depth + profile.depth_step > profile.maximum_depth) {
        reason = "confirmation_depth_limit";
        continue;
      }
      const prior_endpoint = ray.endpoint_decimal;
      if (!probe(depth + profile.depth_step)) break;
      const second = nearest(ray.endpoint_decimal, candidate, precision);
      const movement = decimal_distance(
        prior_endpoint,
        ray.endpoint_decimal,
        precision,
      );
      const floor = 10 ** -(precision - 16);
      if (
        first.point_index !== second.point_index ||
        second.distance > profile.landing_tolerance ||
        second.distance > Math.max(movement * 8, floor)
      ) {
        reason = "representative_not_converged";
        // More inverse depth cannot remove error in the Newton cycle itself.
        // Escalation is only a retry heuristic: the same approach/closure and
        // independent assignment checks must still pass at the new precision.
        const cycle_floor = Math.max(
          floor,
          Number(candidate.closure_error) * 8,
        );
        if (
          first.point_index === second.point_index &&
          second.distance > Math.max(movement * 8, floor) &&
          second.distance <= cycle_floor &&
          precision < profile.maximum_precision
        ) {
          refinement_attempts.push({
            depth,
            period,
            precision_digits: precision,
            reason: "confirmation_precision_floor",
          });
          precision = Math.min(
            profile.maximum_precision,
            Math.max(profile.precision_digits, precision * 2),
          );
          statistics.precision_raises++;
          probe(depth);
          continue discovery;
        }
        refinement_attempts.push({
          depth,
          period,
          precision_digits: precision,
          reason,
        });
        continue;
      }
      const final_precision = Math.max(precision, profile.precision_digits);
      if (final_precision > precision) {
        statistics.precision_raises++;
        precision = final_precision;
        if (!probe(depth)) break;
      }
      const refined = refine(
        candidate.period,
        candidate.points[second.point_index],
        final_precision,
        profile.newton_iterations,
      );
      if (cancelled()) return { ...base, status: "cancelled" };
      if (!refined || !same_orbital_cycle(candidate.points, refined.points)) {
        reason = "closure_failed";
        continue;
      }
      const final = nearest(ray.endpoint_decimal, refined, final_precision);
      const final_log = multiplier_log(refined);
      if (
        final.distance > profile.landing_tolerance ||
        !(final_log > Math.log(1 + 1e-6))
      ) {
        reason = "landing_mismatch";
        continue;
      }
      const lifecycle_state = normalize_orbital_lifecycle({
        ...normalize_orbital_lifecycle(null),
        orbital: "validated",
      });
      return {
        ...base,
        status: "orbital_candidate",
        candidate: refined,
        lifecycle_state,
        connectedness,
        family: {
          catalog_key: family.key,
          denominator: family.denominator,
          angle_period: family.angle_period,
        },
        representative: {
          angle: family.angles[0],
          depth,
          potential: ray.potential,
          endpoint_decimal: ray.endpoint_decimal,
          precision_error: ray.precision_error,
          point_index: final.point_index,
          landing_distance: final.distance,
        },
        evidence: {
          association: "pending",
          multiplier_log: final_log,
          approach: {
            previous_distance: first.distance,
            current_distance: second.distance,
            endpoint_movement: movement,
            confirmation_depth_step: profile.depth_step,
          },
        },
        landing_ratios: [],
        rays: [],
      };
    }
    if (depth >= profile.maximum_depth) return unresolved(reason);
    if (!ray.endpoint_decimal || ray.reason !== "potential_limit") continue;
    probe(Math.min(profile.maximum_depth, depth + profile.depth_step));
  }
};
