import Decimal from "decimal.js";
import {
  rational_angle,
  distance,
  finite,
  doubled_angle,
  add,
  mul,
} from "./FractoRayGeometry.js";
import { SEED_SURVEY_RAY_OPTIONS } from "./FractoDynamicRays.js";

export const ORBITAL_RAY_CACHE_VERSION = "orbital-julia-rays-v1";
// Match the bounded, chunk-backed persistent cache; catalog families can exceed
// the old 20 MiB upload limit even though no paths are generated in discovery.
export const MAX_ORBITAL_RAY_WRITE_BYTES = 96 * 1024 * 1024;
const canonical = (value) => {
  if (
    !["string", "number"].includes(typeof value) ||
    String(value).trim() === ""
  )
    throw Error("invalid_ray_coordinates");
  const d = new Decimal(value);
  if (!d.isFinite()) throw Error("invalid_ray_coordinates");
  return d.toString();
};
const point = (p) => ({ re: canonical(p.re), im: canonical(p.im) });
// MySQL JSON storage can reorder object properties; identity must ignore key order.
const ordered = (value) =>
  Array.isArray(value)
    ? value.map(ordered)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, ordered(value[key])]),
        )
      : value;

/** Full immutable numerical identity; display size, scope, and labels are excluded. */
export const orbital_ray_identity = (request) => {
  if (
    !request ||
    !/^[1-9]\d{0,19}$/.test(String(request.orbital_id)) ||
    !Number.isSafeInteger(request.period) ||
    request.period < 1 ||
    request.orbital_points?.length !== request.period ||
    !Array.isArray(request.requests)
  )
    throw Error("invalid_ray_request");
  const accesses = request.requests
    .map((r) => {
      if (
        !Number.isInteger(r.point_index) ||
        r.point_index < 0 ||
        r.point_index >= request.period
      )
        throw Error("invalid_ray_target");
      const angle = rational_angle(r.angle.numerator, r.angle.denominator);
      return {
        angle: angle.key,
        point_index: r.point_index,
        landing_point: point(r.landing_point),
      };
    })
    .sort((a, b) => a.angle.localeCompare(b.angle));
  if (new Set(accesses.map((a) => a.angle)).size !== accesses.length)
    throw Error("ambiguous_ray_angles");
  return {
    orbital_id: String(request.orbital_id),
    focal_point: {
      x: canonical(request.focal_point.x),
      y: canonical(request.focal_point.y),
    },
    period: request.period,
    orbital_points: request.orbital_points.map(point),
    accesses,
  };
};

export const orbital_ray_cache_matches = (cache, request) => {
  try {
    return (
      cache?.version === ORBITAL_RAY_CACHE_VERSION &&
      JSON.stringify(ordered(cache.identity)) ===
        JSON.stringify(ordered(orbital_ray_identity(request)))
    );
  } catch {
    return false;
  }
};

const quality = (profile = SEED_SURVEY_RAY_OPTIONS) => {
  const { tolerance, precision_digits, minimum_depth } = profile;
  if (
    !Number.isFinite(tolerance) ||
    tolerance <= 0 ||
    tolerance > 0.01 ||
    !Number.isInteger(precision_digits) ||
    precision_digits < 64 ||
    precision_digits > 512 ||
    !Number.isInteger(minimum_depth) ||
    minimum_depth < 1 ||
    minimum_depth > 2048
  )
    throw Error("invalid_ray_quality");
  return { tolerance, precision_digits, minimum_depth };
};

/** Validate accepted family geometry again at the persistence boundary. */
const validate_rays = (identity, rays, profile) => {
  if (
    !Array.isArray(rays) ||
    !rays.length ||
    rays.length > identity.accesses.length
  )
    throw Error("invalid_ray_paths");
  const targets = new Map(identity.accesses.map((a) => [a.angle, a]));
  const accepted = new Map();
  const limit = Math.min(profile.tolerance / 4, 1e-6);
  for (const ray of rays) {
    const angle = rational_angle(ray.angle.numerator, ray.angle.denominator);
    const target = targets.get(angle.key);
    const expected = target && {
      x: Number(target.landing_point.re),
      y: Number(target.landing_point.im),
    };
    if (
      !target ||
      accepted.has(angle.key) ||
      ray.point_index !== target.point_index ||
      ray.reason !== "potential_limit" ||
      !Array.isArray(ray.points) ||
      ray.points.length < 2 ||
      ray.points.length > 16000 ||
      !ray.points.every(finite) ||
      !finite(ray.endpoint) ||
      !Number.isFinite(ray.precision_error) ||
      ray.precision_error < 0 ||
      ray.precision_error > profile.tolerance / 4 ||
      !Number.isFinite(ray.landing_error) ||
      ray.landing_error < 0 ||
      ray.landing_error > limit ||
      distance(ray.endpoint, expected) > limit ||
      distance(ray.endpoint, ray.points.at(-1)) > 1e-14 ||
      distance(ray.endpoint, {
        x: Number(identity.orbital_points[target.point_index].re),
        y: Number(identity.orbital_points[target.point_index].im),
      }) > limit
    )
      throw Error("invalid_ray_paths");
    accepted.set(angle.key, {
      ...ray,
      angle,
      landing_point: target.landing_point,
      landing_error: distance(ray.endpoint, expected),
    });
  }
  const c = {
    x: Number(identity.focal_point.x),
    y: Number(identity.focal_point.y),
  };
  for (const ray of accepted.values()) {
    const partner = accepted.get(doubled_angle(ray.angle).key);
    if (
      !partner ||
      distance(add(mul(ray.endpoint, ray.endpoint), c), partner.endpoint) >=
        profile.tolerance / 2
    )
      throw Error("incomplete_ray_family");
  }
  return [...accepted.values()];
};

/** Merge only validated paths. Failed or weaker attempts never replace better geometry. */
export const merge_orbital_ray_cache = (
  previous,
  request,
  rays,
  profile = SEED_SURVEY_RAY_OPTIONS,
) => {
  const identity = orbital_ray_identity(request),
    q = quality(profile);
  const checked = validate_rays(identity, rays, q);
  const entries = orbital_ray_cache_matches(previous, request)
    ? { ...previous.entries }
    : {};
  const timestamp = new Date().toISOString();
  for (const ray of checked) {
    const old = entries[ray.angle.key];
    const better =
      !old ||
      (q.tolerance <= old.quality.tolerance &&
        q.precision_digits >= old.quality.precision_digits &&
        q.minimum_depth >= old.quality.minimum_depth &&
        (q.tolerance < old.quality.tolerance ||
          q.precision_digits > old.quality.precision_digits ||
          q.minimum_depth > old.quality.minimum_depth ||
          ray.landing_error <= old.ray.landing_error));
    if (better)
      entries[ray.angle.key] = { ray, quality: q, computed_at: timestamp };
  }
  return {
    version: ORBITAL_RAY_CACHE_VERSION,
    identity,
    entries,
    updated_at: timestamp,
  };
};

export const cached_orbital_rays = (
  cache,
  request,
  profile = SEED_SURVEY_RAY_OPTIONS,
) => {
  if (!orbital_ray_cache_matches(cache, request)) return [];
  const q = quality(profile);
  const eligible = Object.values(cache.entries || {}).filter(
    (entry) =>
      entry.quality?.tolerance <= q.tolerance &&
      entry.quality?.precision_digits >= q.precision_digits &&
      entry.quality?.minimum_depth >= q.minimum_depth,
  );
  // Keep whole doubling families together when some entries miss the requested quality.
  const available = new Map(eligible.map((e) => [e.ray.angle.key, e.ray]));
  let changed;
  do {
    changed = false;
    for (const [key, ray] of available)
      if (!available.has(doubled_angle(ray.angle).key)) {
        available.delete(key);
        changed = true;
      }
  } while (changed);
  if (!available.size) return [];
  try {
    return validate_rays(cache.identity, [...available.values()], q);
  } catch {
    return [];
  }
};
