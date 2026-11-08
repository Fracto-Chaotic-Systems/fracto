import { rational_angle } from "./FractoRayGeometry.js";

const coordinate = (value) => {
  if (
    !["number", "string"].includes(typeof value) ||
    String(value).trim() === "" ||
    !Number.isFinite(Number(value))
  )
    throw Error("invalid_coordinate");
  return String(value).trim();
};

const integer = (value) => {
  if (
    (typeof value === "number" && !Number.isSafeInteger(value)) ||
    !["string", "number"].includes(typeof value) ||
    !/^-?\d+$/.test(String(value))
  )
    throw Error("invalid_ratio");
  return String(value);
};

/** Prepare only stored accesses; never enumerate candidate angles or trace rays.
 * Coordinates and angle integers retain their stored precision for worker use.
 */
export const build_orbital_trace_request = (focal_point, orbital) => {
  if (!orbital || orbital.orbital_id == null) return null;
  let parameter;
  try {
    parameter = {
      x: coordinate(focal_point?.x),
      y: coordinate(focal_point?.y),
    };
  } catch {
    return null;
  }
  const period = Number(orbital.period);
  if (
    !Number.isSafeInteger(period) ||
    period <= 0 ||
    !Array.isArray(orbital.points)
  )
    return null;

  const requests = [],
    rejected = [],
    seen = new Set();
  for (const point of orbital.points) {
    for (const ratio of point.landing_ratios || []) {
      try {
        if (
          !Number.isSafeInteger(point.point_index) ||
          point.point_index < 0 ||
          point.point_index >= period
        )
          throw Error("invalid_point_index");
        const landing_point = {
          re: coordinate(point.point?.re),
          im: coordinate(point.point?.im),
        };
        const angle = rational_angle(
          integer(ratio.numerator),
          integer(ratio.denominator),
        );
        const key = `${point.point_index}:${angle.key}`;
        if (seen.has(key)) continue;
        seen.add(key);
        requests.push({
          point_index: point.point_index,
          landing_point,
          angle,
          family_key: ratio.family_key ?? null,
          angle_period: ratio.angle_period ?? null,
          validation_status: ratio.validation_status ?? null,
        });
      } catch (error) {
        rejected.push({
          point_index: point.point_index,
          reason: error.message,
        });
      }
    }
  }
  return {
    orbital_id: String(orbital.orbital_id),
    focal_point: parameter,
    period,
    orbital_points: orbital.points.map((point) => ({ ...point.point })),
    requests,
    rejected,
  };
};
