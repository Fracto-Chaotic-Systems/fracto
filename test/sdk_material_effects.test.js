import assert from "node:assert/strict";
import test from "node:test";
import { FractoColors } from "@fracto/sdk/FractoColors.js";
import {
  FIRE_CARDINALITIES,
  FIRE_PALETTES,
  fire_palette,
  material_effects_or_empty,
  resolve_fire_colors,
  validate_material_effects,
} from "@fracto/sdk/FractoMaterialEffects.js";

const hue_of = (hex) => {
  const [r, g, b] = [1, 3, 5].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
  );
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  if (!d) return null;
  const h =
    max === r
      ? ((g - b) / d) % 6
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const hue_distance = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

test("missing effects normalize to an empty list", () => {
  assert.deepEqual(validate_material_effects(undefined), []);
  assert.deepEqual(validate_material_effects(null), []);
});

test("fire effect fills defaults; color defaults to cardinality 1", () => {
  const [fire] = validate_material_effects([
    { type: "fire", anchor: [0, 98, -4], size: 40 },
  ]);
  assert.deepEqual(fire, {
    type: "fire",
    anchor: [0, 98, -4],
    size: 40,
    width: null,
    cardinality: 1,
    intensity: 1,
    speed: 1,
    light: true,
    sparks: true,
    shadows: true,
    light_offset: null,
  });
  const [offset] = validate_material_effects([
    { type: "fire", anchor: [0, 0, 0], size: 1, light_offset: [0, 30, -35] },
  ]);
  assert.deepEqual(offset.light_offset, [0, 30, -35]);
});

test("supported flame colors are the odd orbital pattern cardinalities 1-15", () => {
  assert.deepEqual(FIRE_CARDINALITIES, [1, 3, 5, 7, 9, 11, 13, 15]);
  assert.deepEqual(Object.keys(FIRE_PALETTES).map(Number), FIRE_CARDINALITIES);
});

test("each palette takes its hue from FractoColors.pattern_hue", () => {
  for (const cardinality of FIRE_CARDINALITIES) {
    const palette = fire_palette(cardinality);
    const hue = FractoColors.pattern_hue(cardinality);
    assert.equal(palette.hue, hue);
    for (const key of ["core", "body", "tip"]) {
      assert.match(palette[key], /^#[0-9a-f]{6}$/);
      assert.ok(
        hue_distance(hue_of(palette[key]), hue) <= 2,
        `${cardinality} ${key}`,
      );
    }
    assert.deepEqual(resolve_fire_colors(cardinality), {
      core: palette.core,
      body: palette.body,
      tip: palette.tip,
    });
  }
  // Pattern 1 is FractoColors' hue 0 (red); pattern 3 is 210 (blue).
  assert.equal(fire_palette(1).body, "#ff1a1a");
  assert.equal(FIRE_PALETTES[3].hue, 210);
});

test("unsupported cardinalities and invalid fire fields are rejected", () => {
  const base = { type: "fire", anchor: [0, 0, 0], size: 1 };
  for (const cardinality of [0, 2, 4, 17, 1.5, "1", null])
    assert.throws(() => validate_material_effects([{ ...base, cardinality }]));
  for (const effect of [
    { ...base, anchor: [0, 0] },
    { ...base, size: 0 },
    { ...base, intensity: 5 },
    { ...base, speed: -1 },
    { ...base, light: "yes" },
    { ...base, shadows: 1 },
    { ...base, light_offset: [0, 1] },
    { ...base, light_offset: [0, "1", 0] },
    { ...base, color: "orange" },
    { type: "smoke", anchor: [0, 0, 0], size: 1 },
  ])
    assert.throws(() => validate_material_effects([effect]));
  assert.throws(() => validate_material_effects({}));
  assert.throws(() => resolve_fire_colors(2));
  assert.deepEqual(material_effects_or_empty([{ type: "smoke" }]), []);
});
