import { trace_dynamic_ray } from "./FractoDynamicRayTrace.js";
import {
  rational_angle,
  doubled_angle,
  distance,
  add,
  mul,
} from "./FractoRayGeometry.js";

/** Candidate portraits, not claims based on cardinality or winding around Q.
 * Published basis: Milnor, Astérisque 261 (2000), §2 (angle doubling/portraits),
 * https://numdam.org/item/AST_2000__261__277_0/ .
 * Every candidate still requires numerical landing and dynamics validation.
 */
/** Enumerate exact-period doubling cycles once each, using a bitset to exclude
 * every fraction already assigned to a previous cycle. Shorter divisor cycles
 * are marked but omitted. Native integers are exact within the supported bound.
 */
export function* enumerate_doubling_families(period, cancelled = () => false) {
  if (!Number.isInteger(period) || period < 1 || period > 24)
    throw new RangeError("Angle period must be an integer from 1 to 24");
  const denominator = 2 ** period - 1;
  const seen = new Uint8Array(Math.ceil(denominator / 8));
  for (let start = 0; start < denominator; start++) {
    if (cancelled()) return;
    if (seen[start >> 3] & (1 << (start & 7))) continue;
    const numerators = [];
    let value = start;
    do {
      seen[value >> 3] |= 1 << (value & 7);
      numerators.push(value);
      value = (2 * value) % denominator;
    } while (value !== start);
    if (numerators.length === period)
      yield {
        period,
        numerator: String(start),
        denominator: String(denominator),
        angles: numerators.map((numerator) =>
          rational_angle(numerator, denominator),
        ),
      };
  }
}

export const doubling_family_count = (period) => {
  if (!Number.isInteger(period) || period < 1 || period > 24)
    throw new RangeError("Angle period must be an integer from 1 to 24");
  const exact = (n) => {
    let count = 2 ** n - 1;
    for (let divisor = 1; divisor < n; divisor++)
      if (n % divisor === 0) count -= exact(divisor);
    return count;
  };
  return exact(period) / period;
};

/** Trace one entire doubling cycle, optionally aligning its first ray with any
 * selected orbit point. Closure of both the angle cycle and endpoint dynamics
 * must hold before any member of the family is accepted.
 */
export const trace_ray_family = (c, assessment, initial, options = {}) => {
  const {
    tolerance = (3 / 550) * 0.25,
    max_period = 24,
    cancelled = () => false,
    align_to_orbit = false,
  } = options;
  const depth = Math.min(
    384,
    Math.max(
      96,
      Math.ceil(
        (assessment.period * Math.log(1e10)) /
          assessment.multiplier.log_modulus,
      ),
    ),
  );
  let angle = rational_angle(initial.numerator, initial.denominator),
    offset = 0;
  const family = [],
    visited = new Set();
  while (!visited.has(angle.key) && family.length < max_period) {
    if (cancelled()) return { status: "cancelled", rays: [] };
    visited.add(angle.key);
    const ray = trace_dynamic_ray(c, angle, {
      tolerance,
      minimum_potential: 2 ** -depth,
      max_points: 6000,
      verify_precision: true,
      cancelled,
    });
    if (cancelled()) return { status: "cancelled", rays: [] };
    if (align_to_orbit && family.length === 0) {
      offset = assessment.points.reduce(
        (best, point, index) =>
          distance(ray.endpoint, point) <
          distance(ray.endpoint, assessment.points[best])
            ? index
            : best,
        0,
      );
    }
    const point_index = (offset + family.length) % assessment.period;
    const landing = assessment.points[point_index],
      error = distance(ray.endpoint, landing);
    const earlier = ray.points[Math.max(0, ray.points.length - 80)];
    if (
      ray.reason !== "potential_limit" ||
      error > Math.min(tolerance * 0.25, 1e-6) ||
      distance(earlier, landing) < error * 0.8
    )
      return { status: "family_mismatch", rays: [] };
    family.push({ ...ray, point_index, landing_error: error });
    angle = doubled_angle(angle);
  }
  if (
    angle.key !== rational_angle(initial.numerator, initial.denominator).key ||
    family.length % assessment.period !== 0
  )
    return { status: "family_mismatch", rays: [] };
  if (
    !family.every(
      (ray, index) =>
        distance(
          add(mul(ray.endpoint, ray.endpoint), c),
          family[(index + 1) % family.length].endpoint,
        ) <
        tolerance * 0.5,
    )
  )
    return { status: "family_mismatch", rays: [] };
  return { status: "rays_found", rays: family };
};
