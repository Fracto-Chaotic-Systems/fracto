import BigComplex from "../math/BigComplex.js";
import {
  canonical_orbital,
  orbital_parameter,
} from "./FractoOrbitalIdentity.js";
import { create_dynamic_ray_tracer } from "./FractoDynamicRayTrace.js";
import {
  validate_catalog_ray_family,
  trace_catalog_ray_family,
} from "./FractoCatalogDynamicRays.js";
import { validate_landing_families } from "./FractoOrbitalDiscovery.js";
import { connectedness_evidence } from "./FractoRayEligibility.js";
import { normalize_orbital_lifecycle } from "./FractoOrbitalLifecycle.js";
import {
  discover_representative_orbital,
  REPRESENTATIVE_RAY_SOLVER_VERSION,
} from "./FractoRepresentativeRaySolver.js";

export const LANDING_ASSIGNMENT_VERSION =
  "catalog-representative-assignments-v1";
export const LANDING_ASSIGNMENT_OPTIONS = Object.freeze({
  precision_digits: 128,
  maximum_depth: 512,
  minimum_outer_depth: 32,
  depth_step: 16,
  max_attempts: 4,
  max_points: 16000,
  trace_tolerance: 1e-4,
  landing_tolerance: 1e-7,
  maximum_radius: 1e-5,
});
export const landing_assignment_profile = (options = {}) => {
  const profile = Object.fromEntries(
    Object.entries(LANDING_ASSIGNMENT_OPTIONS).map(([key, value]) => [
      key,
      options[key] ?? value,
    ]),
  );
  for (const [key, value] of Object.entries(profile))
    if (
      !Number.isFinite(value) ||
      value <= 0 ||
      (!["trace_tolerance", "landing_tolerance", "maximum_radius"].includes(
        key,
      ) &&
        !Number.isSafeInteger(value))
    )
      throw Error("invalid_assignment_profile");
  if (
    profile.precision_digits < 64 ||
    profile.precision_digits > 512 ||
    profile.maximum_depth > 1020 ||
    profile.minimum_outer_depth < 8 ||
    profile.minimum_outer_depth >= profile.maximum_depth ||
    profile.depth_step > 128 ||
    profile.max_attempts > 16 ||
    profile.max_points > 16000 ||
    profile.trace_tolerance > 0.01 ||
    profile.landing_tolerance > 1e-6 ||
    profile.maximum_radius > 0.01
  )
    throw Error("invalid_assignment_profile");
  return profile;
};
const metric = (D, a, b) =>
  new D(a.re).minus(b.re).pow(2).plus(new D(a.im).minus(b.im).pow(2)).sqrt();
const upper = (value) => value.toSignificantDigits(24, 2).toString();

/** Guarded Decimal sufficient bounds for a contracting product of local inverse
 * branches. These are numerical validation bounds, not interval arithmetic.
 * For z_i, radii r_i, require 2(|z_i|-r_i)r_i > r_(i+1)+residual.
 * The stronger derivative bound also gives a weighted contraction and a bound
 * on the difference between the approximate and true periodic centers.
 */
const inverse_trap = (parameter, points, profile, D, supplied = null) => {
  const magnitudes = points.map((p) =>
    new D(p.re).pow(2).plus(new D(p.im).pow(2)).sqrt(),
  );
  if (magnitudes.some((a) => a.isZero())) return null;
  const logs = magnitudes.map((a) => Math.log(2 * a.toNumber()));
  const total = logs.reduce((sum, value) => sum + value, 0);
  if (!(total > Math.log(1 + 1e-6))) return null;
  const average = total / points.length,
    weights = [0];
  for (let i = 1; i < points.length; i++)
    weights[i] = weights[i - 1] + logs[i - 1] - average;
  const largest = Math.max(...weights),
    guard = new D(10).pow(-(D.precision - 16));
  const residuals = points.map((p, i) => {
    const next = points[(i + 1) % points.length],
      x = new D(p.re),
      y = new D(p.im);
    return x
      .mul(x)
      .minus(y.mul(y))
      .plus(parameter.x)
      .minus(next.re)
      .pow(2)
      .plus(x.mul(y).mul(2).plus(parameter.y).minus(next.im).pow(2))
      .sqrt()
      .plus(guard.mul(1024));
  });
  for (let attempt = 0; attempt < (supplied ? 1 : 8); attempt++) {
    const radii = supplied
      ? supplied.map((r) => new D(r))
      : weights.map((weight) =>
          new D(profile.maximum_radius)
            .div(new D(4).pow(attempt))
            .mul(new D(weight - largest).exp())
            .toSignificantDigits(24, 3),
        );
    if (
      radii.length !== points.length ||
      radii.some(
        (r) => !r.isFinite() || r.lte(0) || r.gt(profile.maximum_radius),
      )
    )
      return null;
    let contraction = new D(0),
      epsilon = new D(0),
      valid = true;
    for (let i = 0; i < points.length; i++) {
      const next = radii[(i + 1) % points.length],
        radius = radii[i];
      if (radius.gte(magnitudes[i].div(4))) {
        valid = false;
        break;
      }
      const slope = magnitudes[i].minus(radius).mul(2).minus(guard);
      const margin = slope.mul(radius).minus(next).minus(residuals[i]);
      if (margin.lte(guard)) {
        valid = false;
        break;
      }
      contraction = D.max(contraction, next.div(slope.mul(radius)).plus(guard));
      epsilon = D.max(epsilon, residuals[i].div(slope.mul(radius)).plus(guard));
    }
    if (!valid || contraction.gte(1)) continue;
    const errors = radii.map((r) =>
      r.mul(epsilon).div(new D(1).minus(contraction)).plus(guard),
    );
    if (
      errors.some(
        (error, i) =>
          error.gte(radii[i].div(16)) ||
          error.gte(new D(profile.landing_tolerance).div(16)),
      )
    )
      continue;
    return { radii, errors, contraction, guard };
  }
  return null;
};

/** Independently associate one representative with a closed orbit, then infer
 * every exact doubled-angle assignment. No drawing paths are retained. The
 * representative arc is streamed through a local inverse trap, and terminal
 * transport is recomputed in Decimal along that same branch chain. Ambiguity
 * stays pending. Optional full fallback validates paths transiently, discarding
 * them; it is never used by default.
 */
export const validate_representative_assignments = (
  parameter,
  input_family,
  discovery,
  options = {},
) => {
  const exact = orbital_parameter(parameter),
    family = validate_catalog_ray_family(input_family);
  const profile = landing_assignment_profile(options),
    cancelled = options.cancelled || (() => false);
  if (
    (options.cancelled !== undefined &&
      typeof options.cancelled !== "function") ||
    (options.on_progress !== undefined &&
      typeof options.on_progress !== "function") ||
    (options.full_fallback !== undefined &&
      typeof options.full_fallback !== "boolean")
  )
    throw Error("invalid_assignment_options");
  if (
    discovery?.status !== "orbital_candidate" ||
    discovery.solver_version !== REPRESENTATIVE_RAY_SOLVER_VERSION ||
    JSON.stringify(orbital_parameter(discovery.parameter)) !==
      JSON.stringify(exact) ||
    discovery.family?.catalog_key !== family.key ||
    discovery.family.angle_period !== family.angle_period ||
    discovery.family.denominator !== family.denominator ||
    discovery.representative?.angle?.key !== family.key
  )
    throw Error("invalid_assignment_candidate");
  const candidate = canonical_orbital(
    exact,
    discovery.candidate?.points,
    discovery.candidate?.precision_digits,
  );
  if (
    !candidate ||
    candidate.period !== discovery.candidate.period ||
    family.angle_period % candidate.period ||
    JSON.stringify(candidate.points) !==
      JSON.stringify(discovery.candidate.points) ||
    !Number.isInteger(candidate.precision_digits) ||
    candidate.precision_digits < 64 ||
    candidate.precision_digits > 512
  )
    throw Error("invalid_assignment_orbital");
  const anchor = discovery.representative.point_index;
  if (
    !Number.isSafeInteger(anchor) ||
    anchor < 0 ||
    anchor >= candidate.period ||
    !Number.isSafeInteger(discovery.representative.depth) ||
    discovery.representative.depth < 1 ||
    discovery.representative.depth > 1020
  )
    throw Error("invalid_assignment_anchor");
  const precision = Math.max(
    profile.precision_digits,
    candidate.precision_digits,
  );
  const D = new BigComplex(0, 0, precision).Decimal,
    c = { x: Number(exact.x), y: Number(exact.y) };
  const state = { ...normalize_orbital_lifecycle(null), orbital: "validated" };
  state.paths.required_rays = family.angle_period;
  const statistics = {
    representative_traces: 0,
    transport_checks: 0,
    arc_samples: 0,
    sibling_rays_traced: 0,
    full_family_rays_traced: 0,
    retained_points: 0,
  };
  const base = {
    ...discovery,
    candidate,
    landing_ratios: [],
    rays: [],
    assignment_version: LANDING_ASSIGNMENT_VERSION,
    lifecycle_state: normalize_orbital_lifecycle(state),
    evidence: {
      ...discovery.evidence,
      association: "pending",
      assignment_validation: undefined,
    },
    assignment_profile: {
      ...profile,
      precision_digits: precision,
      full_fallback: !!options.full_fallback,
    },
    assignment_statistics: statistics,
  };
  const pending = (reason) => ({
    ...base,
    status: cancelled() ? "cancelled" : "assignments_pending",
    reason,
  });
  if (cancelled()) return pending("cancelled");
  const connectedness = connectedness_evidence(c);
  if (connectedness.status !== "connected")
    return pending(connectedness.status);
  const trap = inverse_trap(exact, candidate.points, profile, D);
  let reason = trap ? "depth_limit" : "inverse_trap_unresolved";
  const landing_key = family.angles.map((angle) => angle.key).sort()[0];
  const accepted = (ratios, evidence) => {
    validate_landing_families(ratios, candidate.period, {
      max_angle_period: family.angle_period,
    });
    return {
      ...base,
      status: "assignments_verified",
      landing_ratios: ratios,
      family: {
        ...discovery.family,
        period: candidate.period,
        landing_family_key: landing_key,
        representative_point_index: anchor,
      },
      lifecycle_state: normalize_orbital_lifecycle({
        ...state,
        assignments: "verified",
      }),
      evidence: {
        ...base.evidence,
        association: "numerically_verified",
        assignment_validation: {
          version: LANDING_ASSIGNMENT_VERSION,
          validation_kind: "numerical",
          ...evidence,
        },
      },
    };
  };
  const initial_outer =
    Math.max(
      profile.minimum_outer_depth,
      discovery.representative.depth - family.angle_period,
    ) + profile.depth_step;
  if (trap)
    for (let attempt = 0; attempt < profile.max_attempts; attempt++) {
      if (cancelled()) return pending("cancelled");
      const outer_depth = initial_outer + attempt * profile.depth_step,
        inner_depth = outer_depth + family.angle_period;
      if (inner_depth > profile.maximum_depth) {
        reason = "depth_limit";
        break;
      }
      const radius = trap.radii[anchor],
        numeric_guard =
          Number.EPSILON *
          64 *
          Math.max(
            1,
            Math.hypot(
              Number(candidate.points[anchor].re),
              Number(candidate.points[anchor].im),
            ),
          );
      if (radius.lte(new D(numeric_guard).mul(16))) {
        reason = "arc_precision_limit";
        break;
      }
      let inside = true,
        observing = false,
        arc_bound = new D(0),
        arc_count = 0;
      const tracer = create_dynamic_ray_tracer(c, family.angles[0], {
        tolerance: profile.trace_tolerance,
        max_points: profile.max_points,
        retain_geometry: false,
        endpoint_window: 2,
        exact_parameter: exact,
        cancelled,
        on_sample: (sample) => {
          if (!observing) return;
          statistics.arc_samples++;
          arc_count++;
          if (
            ![
              sample.deviation,
              sample.direct_error,
              ...[sample.previous, sample.midpoint, sample.endpoint].flatMap(
                (p) => [p.x, p.y],
              ),
            ].every(Number.isFinite) ||
            sample.deviation < 0 ||
            sample.direct_error < 0
          ) {
            inside = false;
            return;
          }
          const allowance = new D(
            numeric_guard + 4 * sample.deviation + 2 * sample.direct_error,
          );
          for (const point of [
            sample.previous,
            sample.midpoint,
            sample.endpoint,
          ]) {
            const bound = metric(
              D,
              { re: point.x, im: point.y },
              candidate.points[anchor],
            ).plus(allowance);
            arc_bound = D.max(arc_bound, bound);
            if (bound.gte(radius.div(2))) inside = false;
          }
        },
      });
      statistics.representative_traces++;
      const outer = tracer.advance(2 ** -outer_depth, {
        verify_precision: true,
        precision_digits: precision,
      });
      statistics.retained_points = Math.max(
        statistics.retained_points,
        outer.points.length,
      );
      options.on_progress?.({
        stage: "assignment_outer",
        attempt,
        depth: outer_depth,
      });
      if (cancelled()) return pending("cancelled");
      if (
        outer.reason !== "potential_limit" ||
        !outer.endpoint_decimal ||
        !Number.isFinite(outer.precision_error)
      ) {
        reason =
          outer.reason === "potential_limit" ? "precision_limit" : outer.reason;
        continue;
      }
      if (
        metric(D, outer.endpoint_decimal, candidate.points[anchor])
          .plus(numeric_guard)
          .gte(radius.div(2))
      ) {
        reason = "representative_outside_trap";
        continue;
      }
      observing = true;
      const inner = tracer.advance(2 ** -inner_depth, {
        verify_precision: true,
        precision_digits: precision,
        transport_levels: family.angle_period,
      });
      statistics.retained_points = Math.max(
        statistics.retained_points,
        inner.points.length,
      );
      options.on_progress?.({
        stage: "assignment_transport",
        attempt,
        depth: inner_depth,
      });
      if (cancelled()) return pending("cancelled");
      if (
        inner.reason !== "potential_limit" ||
        !inner.transport_endpoints ||
        !Number.isFinite(inner.precision_error)
      ) {
        reason =
          inner.reason === "potential_limit" ? "precision_limit" : inner.reason;
        continue;
      }
      if (!inside) {
        reason = "representative_left_trap";
        continue;
      }
      const endpoints = inner.transport_endpoints;
      if (
        metric(D, endpoints[family.angle_period], outer.endpoint_decimal).gte(
          D.min(radius.div(8), profile.landing_tolerance),
        )
      ) {
        reason = "representative_return_mismatch";
        continue;
      }
      const errors = [];
      let consistent = true;
      for (let index = 0; index <= family.angle_period; index++) {
        const point_index = (anchor + index) % candidate.period;
        const distance = metric(
          D,
          endpoints[index],
          candidate.points[point_index],
        );
        const error = distance.plus(trap.errors[point_index]).plus(trap.guard);
        statistics.transport_checks++;
        if (
          distance.gte(trap.radii[point_index].div(2)) ||
          error.gt(profile.landing_tolerance)
        ) {
          consistent = false;
          break;
        }
        errors.push(error.toNumber());
      }
      if (!consistent) {
        reason = "transport_landing_mismatch";
        continue;
      }
      const ratios = family.angles.map((angle, index) => ({
        numerator: angle.numerator,
        denominator: angle.denominator,
        family_key: landing_key,
        angle_period: family.angle_period,
        point_index: (anchor + index) % candidate.period,
        landing_error: errors[index],
        validation_status: "validated",
      }));
      return accepted(ratios, {
        method: "representative_inverse_trap",
        outer_depth,
        inner_depth,
        weighted_contraction: trap.contraction.toString(),
        radii: trap.radii.map((r) => r.toString()),
        orbital_error_bounds: trap.errors.map(upper),
        outer_endpoint: outer.endpoint_decimal,
        transport_endpoints: endpoints,
        arc_samples: arc_count,
        arc_maximum_bound: arc_bound.toString(),
        used_full_fallback: false,
      });
    }
  if (options.full_fallback && !cancelled()) {
    const log_modulus = candidate.points.reduce(
      (sum, p) => sum + Math.log(2 * Math.hypot(Number(p.re), Number(p.im))),
      0,
    );
    if (log_modulus > Math.log(1 + 1e-6)) {
      statistics.full_family_rays_traced = family.angle_period;
      statistics.sibling_rays_traced = Math.max(0, family.angle_period - 1);
      const validation = trace_catalog_ray_family(
        c,
        {
          period: candidate.period,
          points: candidate.points.map((p) => ({
            x: Number(p.re),
            y: Number(p.im),
          })),
          multiplier: { log_modulus },
          connectedness,
        },
        family,
        {
          tolerance: 1e-6,
          minimum_depth: Math.min(
            profile.maximum_depth,
            Math.max(128, discovery.representative.depth),
          ),
          maximum_depth: profile.maximum_depth,
          max_points: profile.max_points,
          precision_digits: precision,
          cancelled,
          initial_point_index: anchor,
        },
      );
      if (validation.status === "rays_found")
        return accepted(
          validation.rays.map((ray) => ({
            numerator: ray.angle.numerator,
            denominator: ray.angle.denominator,
            family_key: landing_key,
            angle_period: family.angle_period,
            point_index: ray.point_index,
            landing_error: ray.landing_error,
            validation_status: "validated",
          })),
          { method: "full_family_fallback", used_full_fallback: true },
        );
      reason = validation.reason || validation.status;
    }
  }
  return pending(reason);
};

/** Persistence boundary for trusted worker evidence: independently recheck
 * compact inverse bounds, transport and exact mappings without tracing again.
 * Stream summaries retain the same numerical (not interval-certified) meaning.
 */
export const recheck_landing_assignment_evidence = (
  parameter,
  family,
  result,
  options = {},
) => {
  const bad = () => {
    throw Error("invalid_compact_assignment_evidence");
  };
  try {
    const exact = orbital_parameter(parameter),
      profile = landing_assignment_profile(options);
    validate_catalog_ray_family(family);
    const candidate = canonical_orbital(
      exact,
      result.candidate?.points,
      result.candidate?.precision_digits,
    );
    if (
      !candidate ||
      candidate.period !== result.candidate.period ||
      family.angle_period % candidate.period ||
      candidate.points.some(
        (p, i) =>
          p.re !== result.candidate.points[i].re ||
          p.im !== result.candidate.points[i].im,
      ) ||
      !Number.isSafeInteger(candidate.precision_digits) ||
      candidate.precision_digits < 64 ||
      candidate.precision_digits > 512 ||
      result.status !== "assignments_verified" ||
      result.assignment_version !== LANDING_ASSIGNMENT_VERSION ||
      result.solver_version !== REPRESENTATIVE_RAY_SOLVER_VERSION ||
      result.rays?.length ||
      orbital_parameter(result.parameter).x !== exact.x ||
      orbital_parameter(result.parameter).y !== exact.y ||
      result.family?.catalog_key !== family.key ||
      result.family.denominator !== family.denominator ||
      result.family.angle_period !== family.angle_period
    )
      bad();
    const proof = result.evidence?.assignment_validation,
      anchor = result.family.representative_point_index;
    const precision = Math.max(
      candidate.precision_digits,
      profile.precision_digits,
    );
    if (
      !proof ||
      proof.version !== LANDING_ASSIGNMENT_VERSION ||
      proof.method !== "representative_inverse_trap" ||
      proof.used_full_fallback !== false ||
      !Number.isSafeInteger(anchor) ||
      anchor < 0 ||
      anchor >= candidate.period ||
      !Number.isSafeInteger(proof.outer_depth) ||
      !Number.isSafeInteger(proof.inner_depth) ||
      proof.outer_depth < profile.minimum_outer_depth ||
      proof.inner_depth - proof.outer_depth !== family.angle_period ||
      proof.inner_depth > profile.maximum_depth ||
      !Number.isSafeInteger(proof.arc_samples) ||
      proof.arc_samples < 1 ||
      proof.arc_samples > profile.max_points ||
      !Array.isArray(proof.transport_endpoints) ||
      proof.transport_endpoints.length !== family.angle_period + 1 ||
      !Array.isArray(proof.radii) ||
      proof.radii.length !== candidate.period ||
      !Array.isArray(proof.orbital_error_bounds) ||
      proof.orbital_error_bounds.length !== candidate.period ||
      Object.entries(profile).some(
        ([key, value]) =>
          result.assignment_profile?.[key] !==
          (key === "precision_digits" ? precision : value),
      )
    )
      bad();
    const point_ok = (p) =>
      p &&
      [p.re, p.im].every(
        (n) =>
          typeof n === "string" &&
          n.length <= 768 &&
          /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(n),
      );
    if (
      !point_ok(proof.outer_endpoint) ||
      proof.transport_endpoints.some((p) => !point_ok(p)) ||
      proof.radii.some((r) => typeof r !== "string" || r.length > 768)
    )
      bad();
    const D = new BigComplex(0, 0, precision).Decimal,
      trap = inverse_trap(exact, candidate.points, profile, D, proof.radii);
    if (!trap) bad();
    const slack = trap.guard.mul(2048),
      contraction = new D(proof.weighted_contraction),
      arc = new D(proof.arc_maximum_bound);
    if (
      !contraction.isFinite() ||
      contraction.gte(1) ||
      contraction.lt(trap.contraction.minus(slack)) ||
      !arc.isFinite() ||
      arc.lt(0) ||
      arc.gte(trap.radii[anchor].div(2))
    )
      bad();
    if (
      metric(D, proof.outer_endpoint, candidate.points[anchor]).gte(
        trap.radii[anchor].div(2),
      ) ||
      metric(
        D,
        proof.transport_endpoints[family.angle_period],
        proof.outer_endpoint,
      ).gte(D.min(trap.radii[anchor].div(8), profile.landing_tolerance))
    )
      bad();
    const key = family.angles.map((a) => a.key).sort()[0];
    const ratios = result.landing_ratios;
    validate_landing_families(ratios, candidate.period, {
      max_angle_period: family.angle_period,
    });
    if (
      ratios.length !== family.angle_period ||
      result.family.landing_family_key !== key
    )
      bad();
    const by_angle = new Map(
      ratios.map((ratio) => [`${ratio.numerator}/${ratio.denominator}`, ratio]),
    );
    for (let i = 0; i <= family.angle_period; i++) {
      const index = (anchor + i) % candidate.period,
        endpoint = proof.transport_endpoints[i];
      const distance = metric(D, endpoint, candidate.points[index]);
      const bound = new D(proof.orbital_error_bounds[index]);
      if (
        !bound.isFinite() ||
        bound.lt(trap.errors[index].minus(slack)) ||
        distance.gte(trap.radii[index].div(2)) ||
        distance.plus(bound).gt(profile.landing_tolerance)
      )
        bad();
      if (i < family.angle_period) {
        const ratio = by_angle.get(family.angles[i].key);
        if (
          !ratio ||
          ratio.point_index !== index ||
          ratio.family_key !== key ||
          ratio.landing_error <
            distance.plus(trap.errors[index]).toNumber() * (1 - 1e-12)
        )
          bad();
      }
      if (i > 0) {
        const prior = proof.transport_endpoints[i - 1],
          x = new D(prior.re),
          y = new D(prior.im);
        const mapped = {
          re: x.mul(x).minus(y.mul(y)).plus(exact.x).toString(),
          im: x.mul(y).mul(2).plus(exact.y).toString(),
        };
        if (metric(D, mapped, endpoint).gt(slack)) bad();
      }
    }
    return candidate;
  } catch {
    return bad();
  }
};

export const discover_validated_representative_orbital = (
  parameter,
  family,
  options = {},
) => {
  const discovery = discover_representative_orbital(parameter, family, {
    ...options.discovery,
    cancelled: options.cancelled ?? options.discovery?.cancelled,
    on_progress: options.on_progress ?? options.discovery?.on_progress,
  });
  return discovery.status === "orbital_candidate"
    ? validate_representative_assignments(parameter, family, discovery, {
        ...options.validation,
        cancelled: options.cancelled ?? options.validation?.cancelled,
        on_progress: options.on_progress ?? options.validation?.on_progress,
      })
    : discovery;
};
