import {
  assess_ray_orbital,
  connectedness_evidence,
} from "./FractoRayEligibility.js";
import { canonical_orbital } from "./FractoOrbitalIdentity.js";
import { trace_ray_family } from "./FractoRayFamilies.js";
import { SEED_SURVEY_RAY_OPTIONS } from "./FractoDynamicRays.js";
import {
  rational_angle,
  doubled_angle,
  distance,
  finite,
} from "./FractoRayGeometry.js";

/** Trace supplied accesses only. A whole known doubling family must validate. */
export const trace_known_dynamic_rays = async (request, options = {}) => {
  // Known accesses are explicit input, so they do not need the legacy
  // period-24 enumeration cap. Bound work by the supplied family instead.
  const profile = {
    ...SEED_SURVEY_RAY_OPTIONS,
    max_angle_period: 4096,
    ...options,
  };
  if (
    !Number.isSafeInteger(profile.max_angle_period) ||
    profile.max_angle_period < 1 ||
    profile.max_angle_period > 4096
  )
    throw Error("invalid_known_family_limit");
  const cancelled = options.cancelled || (() => false);
  const report = options.on_progress || (() => {});
  const rays = [],
    unresolved = [...(request?.rejected || [])];
  const accesses = request?.requests || [];
  const total = accesses.length;
  let processed = 0;
  const publish = (stage) =>
    report({ stage, processed, total, rays: [...rays] });
  if (!total) return { status: "no_ratios", rays, unresolved };
  publish("classifying");
  if (cancelled()) return { status: "cancelled", rays: [], unresolved };
  const points = (request.orbital_points || []).map((p) => ({
    x: Number(p.re),
    y: Number(p.im),
  }));
  const c = {
    x: Number(request.focal_point?.x),
    y: Number(request.focal_point?.y),
  };
  if (points.length !== request.period || !points.every(finite) || !finite(c))
    return { status: "invalid_input", rays, unresolved };
  // Catalog coordinates already describe the closed cycle. Recheck them in
  // Decimal arithmetic instead of moving a long repelling cycle through a
  // second Newton solve seeded from rounded native coordinates.
  let exact;
  try {
    exact = canonical_orbital(request.focal_point, request.orbital_points);
  } catch {
    /* Legacy approximate rows use refinement below. */
  }
  let assessment;
  if (exact?.period === request.period) {
    const log_modulus = points.reduce(
      (sum, p) => sum + Math.log(2 * Math.hypot(p.x, p.y)),
      0,
    );
    const connectedness = connectedness_evidence(c);
    assessment = {
      period: request.period,
      points,
      multiplier: { log_modulus },
      connectedness,
      status:
        log_modulus < Math.log(1 - 1e-6)
          ? "attracting"
          : !(log_modulus > Math.log(1 + 1e-6))
            ? "neutral"
            : connectedness.status === "connected"
              ? "ready"
              : connectedness.status,
    };
  } else assessment = assess_ray_orbital(request.focal_point, { points });
  if (assessment.status !== "ready")
    return { status: assessment.status, rays, unresolved };
  const known = new Map();
  for (const access of accesses) {
    const angle = rational_angle(
      access.angle.numerator,
      access.angle.denominator,
    );
    if (known.has(angle.key))
      return { status: "ambiguous_angles", rays, unresolved };
    known.set(angle.key, { ...access, angle });
  }
  const visited = new Set();
  for (const access of known.values()) {
    if (visited.has(access.angle.key)) continue;
    if (cancelled()) return { status: "cancelled", rays: [], unresolved };
    const family = [],
      family_keys = new Set();
    let angle = access.angle;
    while (
      !family_keys.has(angle.key) &&
      family.length < profile.max_angle_period
    ) {
      const member = known.get(angle.key);
      if (!member || visited.has(angle.key)) break;
      family.push(member);
      family_keys.add(angle.key);
      angle = doubled_angle(angle);
    }
    const closed = angle.key === access.angle.key;
    let accepted = [];
    let reason = "incomplete_family";
    if (
      closed &&
      family.length % request.period === 0 &&
      family.length + 40 <= profile.maximum_depth
    ) {
      // Yield between families; browser workers can also be terminated mid-trace.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const result = trace_ray_family(
        c,
        { ...assessment, points },
        access.angle,
        {
          ...profile,
          max_period: profile.max_angle_period,
          minimum_depth: Math.max(profile.minimum_depth, family.length + 40),
          align_to_orbit: true,
          exact_parameter: request.focal_point,
          cancelled,
          // Progress within a family must not repeatedly clone earlier geometry
          // into worker messages. Only publish this family after validation.
          on_ray: (count) =>
            report({
              stage: "tracing",
              processed: processed + count,
              total,
              rays: [],
            }),
        },
      );
      if (result.status === "cancelled")
        return { status: "cancelled", rays: [], unresolved };
      reason = result.status;
      if (result.status === "rays_found") {
        const checked = result.rays.map((ray) => {
          const target = known.get(ray.angle.key);
          const landing = {
            x: Number(target.landing_point.re),
            y: Number(target.landing_point.im),
          };
          const landing_error = distance(ray.endpoint, landing);
          return {
            ...ray,
            point_index: target.point_index,
            landing_point: target.landing_point,
            landing_error,
          };
        });
        const valid =
          checked.length === family.length &&
          checked.every(
            (ray) =>
              finite(ray.endpoint) &&
              Number.isFinite(ray.landing_error) &&
              ray.landing_error <= Math.min(profile.tolerance / 4, 1e-6) &&
              Number.isInteger(ray.point_index) &&
              points[ray.point_index] &&
              distance(ray.endpoint, points[ray.point_index]) <=
                Math.min(profile.tolerance / 4, 1e-6),
          );
        if (valid) accepted = checked;
        else reason = "landing_mismatch";
      }
    } else if (closed) reason = "family_depth_or_period_limit";
    for (const member of family) {
      visited.add(member.angle.key);
      processed++;
      if (!accepted.length)
        unresolved.push({
          angle: member.angle,
          point_index: member.point_index,
          reason,
        });
    }
    rays.push(...accepted);
    publish("tracing");
  }
  return {
    status: unresolved.length ? "partial" : "rays_found",
    rays,
    unresolved,
    processed,
    total,
  };
};
