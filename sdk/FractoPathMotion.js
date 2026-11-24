// Reusable model-space planar path motion. No renderer, model, page or clock I/O.
const invalid = () => {
  throw new Error("invalid_path_motion");
};
const finite = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;

export function validate_path_motion(value) {
  const keys = [
    "schema_version",
    "algorithm",
    "units",
    "points",
    "speed_mps",
    "ramp_seconds",
    "pause_seconds",
    "turn_seconds",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(value, k)) ||
    value.schema_version !== 1 ||
    value.algorithm !== "polyline-ping-pong-v1" ||
    value.units !== "m" ||
    !Array.isArray(value.points) ||
    value.points.length < 2 ||
    value.points.length > 256 ||
    !finite(value.speed_mps, 0.000001, 1000) ||
    !finite(value.ramp_seconds, 0, 3600) ||
    !finite(value.pause_seconds, 0, 3600) ||
    !finite(value.turn_seconds, 0.001, 3600)
  )
    invalid();
  for (const [i, p] of value.points.entries()) {
    if (
      !Array.isArray(p) ||
      p.length !== 3 ||
      Array.from(p).some((n) => !finite(n, -1000000, 1000000)) ||
      p[1] !== value.points[0][1] ||
      (i &&
        Math.hypot(
          p[0] - value.points[i - 1][0],
          p[2] - value.points[i - 1][2],
        ) < 0.000001)
    )
      invalid();
  }
  return structuredClone(value);
}

export function create_path_motion_controller(value) {
  const definition = validate_path_motion(value),
    points = definition.points;
  const segments = points.slice(1).map((p, i) => ({
    start: points[i],
    end: p,
    length: Math.hypot(p[0] - points[i][0], p[2] - points[i][2]),
  }));
  const distance = segments.reduce((sum, s) => sum + s.length, 0),
    speed = definition.speed_mps;
  const ramp = Math.min(definition.ramp_seconds, distance / speed);
  const travel_seconds = distance / speed + ramp;
  const leg_seconds =
    travel_seconds + definition.pause_seconds + definition.turn_seconds;
  let elapsed = 0;
  const sample = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0)
      throw new Error("invalid_path_motion_time");
    const cycle = seconds % (2 * leg_seconds),
      reverse = cycle >= leg_seconds;
    const t = cycle % leg_seconds;
    let phase = "travel",
      travel,
      velocity = 0,
      turn = 0;
    if (t < travel_seconds) {
      if (ramp && t < ramp) {
        travel = (speed * t * t) / (2 * ramp);
        velocity = (speed * t) / ramp;
      } else if (ramp && t > travel_seconds - ramp) {
        const remaining = travel_seconds - t;
        travel = distance - (speed * remaining * remaining) / (2 * ramp);
        velocity = (speed * remaining) / ramp;
      } else {
        travel = speed * (t - ramp / 2);
        velocity = speed;
      }
    } else {
      travel = distance;
      phase = t < travel_seconds + definition.pause_seconds ? "pause" : "turn";
      if (phase === "turn") {
        const u =
          (t - travel_seconds - definition.pause_seconds) /
          definition.turn_seconds;
        turn = Math.PI * u * u * (3 - 2 * u);
      }
    }
    let along = reverse ? distance - travel : travel;
    // Use the arriving segment at endpoints and the departing one at corners.
    let index = 0;
    while (index < segments.length - 1 && along >= segments[index].length) {
      along -= segments[index].length;
      index++;
    }
    const segment = segments[index],
      ratio = Math.max(0, Math.min(1, along / segment.length));
    const position = segment.start.map(
      (n, i) => n + (segment.end[i] - n) * ratio,
    );
    const sign = reverse ? -1 : 1;
    const heading_radians =
      Math.atan2(
        sign * (segment.end[0] - segment.start[0]),
        sign * (segment.end[2] - segment.start[2]),
      ) + turn;
    return {
      position,
      heading_radians,
      phase,
      direction: sign,
      speed_mps: velocity,
      distance_m: reverse ? distance - travel : travel,
    };
  };
  return {
    travel_seconds,
    leg_seconds,
    cycle_seconds: 2 * leg_seconds,
    sample,
    get pose() {
      return sample(elapsed);
    },
    get elapsed_seconds() {
      return elapsed;
    },
    advance(delta) {
      if (
        !Number.isFinite(delta) ||
        delta < 0 ||
        !Number.isFinite(elapsed + delta)
      )
        throw new Error("invalid_path_motion_time");
      elapsed += delta;
      return sample(elapsed);
    },
    reset(seconds = 0) {
      const pose = sample(seconds);
      elapsed = seconds;
      return pose;
    },
  };
}
