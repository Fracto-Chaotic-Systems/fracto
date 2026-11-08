import { assess_ray_orbital } from "./FractoRayEligibility.js";
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
  const profile = { ...SEED_SURVEY_RAY_OPTIONS, ...options };
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
  const assessment = assess_ray_orbital(request.focal_point, { points });
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
    if (closed) {
      // Yield between families; browser workers can also be terminated mid-trace.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const result = trace_ray_family(
        c,
        { ...assessment, points },
        access.angle,
        {
          ...profile,
          max_period: profile.max_angle_period,
          align_to_orbit: true,
          cancelled,
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
    }
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
