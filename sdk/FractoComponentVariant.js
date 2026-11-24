import { validate_component_document } from "./FractoComponentDocument.js";

// Resolve supported authored deltas into an isolated render preview. Clip rates
// are render options, not extra fields in the persisted scene schema.
export function preview_component_variant(base, variant, revision) {
  validate_component_document(base);
  const fail = () => {
    throw new Error("invalid_component_variant");
  };
  if (
    variant.base?.component_id !== base.id ||
    variant.base.scene_revision !== revision ||
    !Array.isArray(variant.overrides) ||
    variant.overrides.length > 100
  )
    fail();
  const document = structuredClone(base),
    clip_rates = {};
  const touched = new Set();
  for (const override of variant.overrides) {
    const { role, property } = override.target || {};
    const group = variant.role_groups?.[role];
    if (!group || !document.groups.some((item) => item.id === group)) fail();
    const objects = document.objects.filter((item) => item.group_id === group);
    if (
      !objects.length ||
      document.scatters.some((item) => item.group_id === group)
    )
      fail();
    const key = `${group}:${property}`;
    if (touched.has(key)) fail();
    touched.add(key);
    if (
      !["multiply", "replace"].includes(override.operation) ||
      !Number.isFinite(override.value) ||
      override.value < 0
    )
      fail();
    for (const object of objects) {
      if (property === "motion.speed_mps") {
        if (!object.motion) fail();
        object.motion.speed_mps =
          override.operation === "multiply"
            ? object.motion.speed_mps * override.value
            : override.value;
      } else if (property === "walk_clip.playback_rate") {
        if (!object.motion || override.value > 100) fail();
        clip_rates[object.id] = override.value;
      } else fail();
    }
  }
  validate_component_document(document);
  return { document, clip_rates };
}
