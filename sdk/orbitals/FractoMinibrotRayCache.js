import { rational_angle } from "./FractoRayGeometry.js";
import Decimal from "decimal.js";
import { MAX_PARAMETER_PERIOD } from "./FractoParameterPrecision.js";

export const RAY_CACHE_VERSION = "minibrot-parameter-rays-precision32-v1";
export const RAY_CACHE_GROUPS = [
  "root_access",
  "doubling",
  "1/3",
  "2/3",
  "antenna_tip",
];
export const MAX_RAY_GROUP_BYTES = 20 * 1024 * 1024;
export const MAX_RAY_CACHE_BYTES = 96 * 1024 * 1024;
export const ray_cache_identity = (core, period) => {
  if (!Number.isInteger(period) || period < 1 || period > MAX_PARAMETER_PERIOD)
    throw Error("Invalid parent period");
  const coordinate = (value) => {
    if (!(
      typeof value === "number" ||
      (typeof value === "string" && value.trim())
    ))
      throw Error("Invalid core coordinates");
    const d = new Decimal(value);
    if (!d.isFinite()) throw Error("Invalid core coordinates");
    return d.toString();
  };
  return {
    core_point: {
      x: coordinate(core?.exact?.x ?? core?.x),
      y: coordinate(core?.exact?.y ?? core?.y),
    },
    period,
  };
};
export function ray_cache_matches(cache, core, period) {
  try {
    const id = ray_cache_identity(core, period);
    return (
      cache?.version === RAY_CACHE_VERSION &&
      cache.period === period &&
      cache.core_point?.x === id.core_point.x &&
      cache.core_point?.y === id.core_point.y
    );
  } catch {
    return false;
  }
}
export function reusable_ray_group(entry, tolerance) {
  const g = entry?.result;
  return Boolean(
    g?.status === "complete" &&
    entry.tolerance <= tolerance &&
    g.rays?.length &&
    g.rays.every(
      (ray) =>
        ray.landed === true &&
        Number.isFinite(ray.endpoint_error) &&
        ray.endpoint_error <= tolerance,
    ),
  );
}
export function best_ray_group(old, next) {
  if (!old) return next;
  const complete = (e) => e.result.status === "complete";
  if (complete(old) !== complete(next)) return complete(old) ? old : next;
  if (complete(old)) {
    const error = (e) =>
      Math.max(...e.result.rays.map((ray) => ray.endpoint_error));
    if (next.tolerance !== old.tolerance)
      return next.tolerance < old.tolerance ? next : old;
    return error(next) <= error(old) ? next : old;
  }
  const score = (e) => [
    e.result.rays.filter((ray) => ray.landed).length,
    e.result.rays.length,
    e.result.rays.reduce((n, ray) => n + ray.points.length, 0),
  ];
  const a = score(old),
    b = score(next);
  for (let i = 0; i < a.length; i++)
    if (a[i] !== b[i]) return b[i] > a[i] ? next : old;
  return next;
}
export function visible_ray_group(entry, tolerance) {
  if (reusable_ray_group(entry, tolerance)) return entry.result;
  if (entry.result.status !== "complete") return entry.result;
  return {
    ...entry.result,
    status: "incomplete",
    rays: entry.result.rays.map((ray) => ({
      ...ray,
      landed: false,
      status: "incomplete",
    })),
  };
}
/** Validate and clone client results before database storage; no display labels. */
export function validate_ray_group(id, result, tolerance, period) {
  if (
    !RAY_CACHE_GROUPS.includes(id) ||
    !Number.isFinite(tolerance) ||
    tolerance < 1e-12
  )
    throw Error("Invalid ray group or tolerance");
  if (
    !result ||
    typeof result.status !== "string" ||
    result.status.length > 100 ||
    !Array.isArray(result.rays) ||
    result.rays.length > 2
  )
    throw Error("Invalid ray result");
  const copy = JSON.parse(JSON.stringify(result));
  const keys = new Set();
  for (const ray of copy.rays) {
    const angle = ray.angle;
    if (
      !/^\d{1,40}$/.test(angle?.numerator) ||
      !/^\d{1,40}$/.test(angle?.denominator) ||
      BigInt(angle.denominator) <= 0n ||
      BigInt(angle.numerator) >= BigInt(angle.denominator) ||
      angle.key !== `${angle.numerator}/${angle.denominator}`
    )
      throw Error("Invalid ray angle");
    if (keys.has(angle.key)) throw Error("Duplicate ray angle");
    keys.add(angle.key);
    if (
      !Array.isArray(ray.points) ||
      ray.points.length < 2 ||
      ray.points.length > 100000 ||
      !ray.points.every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y))
    )
      throw Error("Invalid ray points");
    if (
      typeof ray.landed !== "boolean" ||
      !Number.isFinite(ray.endpoint_error) ||
      ray.endpoint_error < 0
    )
      throw Error("Invalid ray quality");
    ray.angle = rational_angle(angle.numerator, angle.denominator);
    if (ray.angle.key !== angle.key) throw Error("Angle must be canonical");
    delete ray.display_label;
  }
  if (
    copy.status === "complete" &&
    (!copy.rays.length ||
      copy.rays.some((ray) => !ray.landed || ray.endpoint_error > tolerance))
  )
    throw Error("Invalid completed ray quality");
  if (
    copy.status === "complete" &&
    !(Number.isFinite(copy.root?.x) && Number.isFinite(copy.root?.y))
  )
    throw Error("Missing ray endpoint");
  if (copy.status === "complete" && period) {
    const count =
      period === 1 && (id === "root_access" || id === "antenna_tip") ? 1 : 2;
    if (copy.rays.length !== count) throw Error("Incomplete ray pair");
    if (
      copy.rays.some(
        (ray) =>
          Math.hypot(
            ray.points.at(-1).x - copy.root.x,
            ray.points.at(-1).y - copy.root.y,
          ) >
          tolerance + 1e-14,
      )
    )
      throw Error("Ray endpoint exceeds tolerance");
  }
  return { tolerance, result: copy, computed_at: new Date().toISOString() };
}
export function merge_ray_cache(previous, core, period, id, result, tolerance) {
  const identity = ray_cache_identity(core, period);
  const groups = ray_cache_matches(previous, core, period)
    ? { ...previous.groups }
    : {};
  groups[id] = best_ray_group(
    groups[id],
    validate_ray_group(id, result, tolerance, period),
  );
  return {
    version: RAY_CACHE_VERSION,
    ...identity,
    groups,
    updated_at: new Date().toISOString(),
  };
}
export function cached_ray_result(cache, tolerance) {
  const pick = (id) =>
    cache?.groups?.[id]
      ? visible_ray_group(cache.groups[id], tolerance)
      : { status: "unresolved", rays: [] };
  const root_access = pick("root_access"),
    doubling = pick("doubling"),
    antenna_tip = pick("antenna_tip"),
    thirds = { "1/3": pick("1/3"), "2/3": pick("2/3") };
  const groups = [root_access, doubling, ...Object.values(thirds), antenna_tip],
    rays = groups.flatMap((g) => g.rays);
  return {
    status: groups.every((g) => g.status === "complete")
      ? "complete"
      : rays.length
        ? "partial"
        : "unresolved",
    rays,
    root_access,
    doubling,
    thirds,
    antenna_tip,
  };
}
