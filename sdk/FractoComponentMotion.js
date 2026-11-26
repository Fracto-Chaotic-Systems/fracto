// Authored component motion, independent of a renderer or wall clock. Runtime
// callers supply component time (seconds, scaled by document.animation_speed).
export function validate_component_motion(motion) {
  if (
    !motion ||
    typeof motion !== "object" ||
    Array.isArray(motion) ||
    Object.keys(motion).length !== 3 ||
    !["facing-patrol-v1", "facing-wander-v1"].includes(motion.algorithm) ||
    !Number.isFinite(motion.speed_mps) ||
    motion.speed_mps < 0.000001 ||
    motion.speed_mps > 10 ||
    !Number.isFinite(motion.distance_m) ||
    motion.distance_m < 0.001 ||
    motion.distance_m > 10
  )
    throw new Error("invalid_component_document");
  return structuredClone(motion);
}

const wander_paths = new WeakMap();
function wander_path(object) {
  const seed = String(object.id ?? "wander");
  const cached = wander_paths.get(object);
  if (cached?.seed === seed) return cached;
  let state = 2166136261;
  for (const letter of seed)
    state = Math.imul(state ^ letter.charCodeAt(0), 16777619) >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  // A convex ellipse retains the original forward patrol span, with a small
  // lateral allowance. Chords change heading without drifting out of shelter.
  const points = [[0, 0]];
  let angle = -Math.PI / 2;
  for (let i = 0; i < 16; i++) {
    angle += Math.PI * (0.42 + random() * 0.36);
    const point = [0.25 * Math.cos(angle), 0.5 + 0.5 * Math.sin(angle)];
    const previous = points.at(-1);
    if (
      Math.hypot(...point) < 0.15 ||
      Math.hypot(point[0] - previous[0], point[1] - previous[1]) < 0.15
    )
      continue;
    points.push(point);
  }
  let total = 0;
  const segments = points.map((start, i) => {
    const end = points[(i + 1) % points.length];
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const segment = { start, end, length, offset: total };
    total += length;
    return segment;
  });
  const path = { seed, segments, total };
  wander_paths.set(object, path);
  return path;
}

function sample_wander(object, seconds, distance, speed) {
  const path = wander_path(object);
  let along = ((seconds * speed) / distance) % path.total;
  const segment =
    path.segments.find((item) => along < item.offset + item.length) ??
    path.segments.at(-1);
  along -= segment.offset;
  const t = Math.min(1, Math.max(0, along / segment.length));
  const dx = segment.end[0] - segment.start[0];
  const dz = segment.end[1] - segment.start[1];
  const x = (segment.start[0] + dx * t) * distance;
  const z = (segment.start[1] + dz * t) * distance;
  const yaw = object.rotation[1];
  return {
    position: [
      object.position[0] + Math.cos(yaw) * x + Math.sin(yaw) * z,
      object.position[1],
      object.position[2] - Math.sin(yaw) * x + Math.cos(yaw) * z,
    ],
    rotation: [
      object.rotation[0],
      yaw + Math.atan2(dx, dz),
      object.rotation[2],
    ],
  };
}

// Conservative world-space envelopes for streaming and placement verification.
export function component_motion_bounds(object) {
  if (!object.motion)
    return { min: [...object.position], max: [...object.position] };
  const { distance_m: distance, algorithm } = validate_component_motion(
    object.motion,
  );
  const yaw = object.rotation[1];
  const center = [
    object.position[0] + (Math.sin(yaw) * distance) / 2,
    object.position[1],
    object.position[2] + (Math.cos(yaw) * distance) / 2,
  ];
  const lateral = algorithm === "facing-wander-v1" ? distance / 4 : 0;
  const x = Math.hypot(Math.cos(yaw) * lateral, (Math.sin(yaw) * distance) / 2);
  const z = Math.hypot(Math.sin(yaw) * lateral, (Math.cos(yaw) * distance) / 2);
  return {
    min: [center[0] - x, center[1], center[2] - z],
    max: [center[0] + x, center[1], center[2] + z],
  };
}

export function sample_component_motion(object, seconds) {
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new Error("invalid_component_motion_time");
  const { distance_m: distance, speed_mps: speed } = validate_component_motion(
    object.motion,
  );
  if (object.motion.algorithm === "facing-wander-v1")
    return sample_wander(object, seconds, distance, speed);
  const phase = (seconds * speed) % (2 * distance);
  const backwards = phase >= distance;
  const travel = backwards ? 2 * distance - phase : phase;
  const yaw = object.rotation[1];
  return {
    position: [
      object.position[0] + Math.sin(yaw) * travel,
      object.position[1],
      object.position[2] + Math.cos(yaw) * travel,
    ],
    rotation: [
      object.rotation[0],
      yaw + (backwards ? Math.PI : 0),
      object.rotation[2],
    ],
  };
}
