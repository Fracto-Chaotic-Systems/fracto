// Authored component motion, independent of a renderer or wall clock. Runtime
// callers supply component time (seconds, scaled by document.animation_speed).
export function validate_component_motion(motion) {
  if (
    !motion ||
    typeof motion !== "object" ||
    Array.isArray(motion) ||
    Object.keys(motion).length !== 3 ||
    motion.algorithm !== "facing-patrol-v1" ||
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

export function sample_component_motion(object, seconds) {
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new Error("invalid_component_motion_time");
  const { distance_m: distance, speed_mps: speed } = validate_component_motion(
    object.motion,
  );
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
