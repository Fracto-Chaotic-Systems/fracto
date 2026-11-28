import { FractoColors } from "./FractoColors.js";

// Portable visual effects attached to a material's model (v1: fire).
// Pure data: validation and color resolution only. Renderers live in the UI.
// Positions and sizes are in the model's source units, so an effect stays on its
// anchor whatever scale the preview or a component applies to the model.
const fail = () => {
  throw Object.assign(new Error("invalid_material_effects"), { status: 400 });
};

// Flame colors follow the orbital pattern colors: a fire's `cardinality` picks the
// hue FractoColors.pattern_hue gives that pattern. Supported: the odd cardinalities
// 1–15. Each hue becomes three stops: core (hottest, near white), body and tip.
export const FIRE_CARDINALITIES = Object.freeze([1, 3, 5, 7, 9, 11, 13, 15]);

const hsl_hex = (hue, saturation, lightness) => {
  const s = saturation / 100,
    l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n) => {
    const k = (n + hue / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * value)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
};

export function fire_palette(cardinality) {
  if (!FIRE_CARDINALITIES.includes(cardinality)) fail();
  const hue = FractoColors.pattern_hue(cardinality);
  return {
    cardinality,
    hue,
    core: hsl_hex(hue, 100, 90),
    body: hsl_hex(hue, 100, 55),
    tip: hsl_hex(hue, 95, 30),
  };
}

export const FIRE_PALETTES = Object.freeze(
  Object.fromEntries(
    FIRE_CARDINALITIES.map((cardinality) => [
      cardinality,
      Object.freeze(fire_palette(cardinality)),
    ]),
  ),
);

export function resolve_fire_colors(cardinality = 1) {
  const { core, body, tip } = fire_palette(cardinality);
  return { core, body, tip };
}

const number = (value, min, max) => {
  if (!Number.isFinite(value) || value < min || value > max) fail();
  return value;
};
const vector = (value, count, min, max) => {
  if (!Array.isArray(value) || value.length !== count) fail();
  return value.map((n) => number(n, min, max));
};

const FIRE_DEFAULTS = {
  cardinality: 1,
  intensity: 1,
  speed: 1,
  width: null,
  light: true,
  sparks: true,
  // The fire's light casts shadows (e.g. a torch handle on its wall).
  shadows: true,
  // Light position from the anchor in the model's units: x and z along the
  // model's own axes, y along world up. Null means straight up 0.35 × size.
  light_offset: null,
};
const FIRE_KEYS = ["type", "anchor", "size", ...Object.keys(FIRE_DEFAULTS)];

function validate_fire(effect) {
  const keys = Object.keys(effect);
  if (keys.some((key) => !FIRE_KEYS.includes(key))) fail();
  const value = { ...FIRE_DEFAULTS, ...effect };
  const size = number(value.size, 0.000001, 100000);
  if (!FIRE_CARDINALITIES.includes(value.cardinality)) fail();
  if (
    typeof value.light !== "boolean" ||
    typeof value.sparks !== "boolean" ||
    typeof value.shadows !== "boolean"
  )
    fail();
  return {
    type: "fire",
    anchor: vector(value.anchor, 3, -100000, 100000),
    size,
    width: value.width === null ? null : number(value.width, 0.000001, 100000),
    cardinality: value.cardinality,
    intensity: number(value.intensity, 0, 4),
    speed: number(value.speed, 0, 4),
    light: value.light,
    sparks: value.sparks,
    shadows: value.shadows,
    light_offset:
      value.light_offset === null
        ? null
        : vector(value.light_offset, 3, -100000, 100000),
  };
}

// Returns a normalized copy; undefined/null means "no effects".
export function validate_material_effects(effects) {
  if (effects === undefined || effects === null) return [];
  if (!Array.isArray(effects) || effects.length > 16) fail();
  return effects.map((effect) => {
    if (!effect || Array.isArray(effect) || typeof effect !== "object") fail();
    if (effect.type === "fire") return validate_fire(effect);
    fail();
  });
}

// Lenient read for listings: an invalid record shows no effects rather than failing.
export function material_effects_or_empty(effects) {
  try {
    return validate_material_effects(effects);
  } catch {
    return [];
  }
}
