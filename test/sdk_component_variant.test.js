import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  create_component_document,
  component_document_json,
} from "@fracto/sdk/FractoComponentDocument.js";
import { preview_component_variant } from "@fracto/sdk/FractoComponentVariant.js";
import { sample_component_motion } from "@fracto/sdk/FractoComponentMotion.js";

function fixture() {
  const base = create_component_document(randomUUID(), "Grass strip");
  const group = randomUUID();
  base.groups = [{ id: group, name: "Insects" }];
  const object = {
    id: randomUUID(),
    asset: { id: "ladybug", revision: "a".repeat(64) },
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    group_id: group,
    motion: {
      algorithm: "facing-patrol-v1",
      distance_m: 0.04,
      speed_mps: 0.006,
    },
  };
  base.objects = [
    object,
    { ...structuredClone(object), id: randomUUID(), group_id: null },
  ];
  base.animation_speed = 0.125;
  const variant = {
    key: "zoomies",
    base: { component_id: base.id, scene_revision: 12 },
    role_groups: { walking_insects: group },
    overrides: [
      {
        target: { role: "walking_insects", property: "motion.speed_mps" },
        operation: "multiply",
        value: 8,
      },
      {
        target: {
          role: "walking_insects",
          property: "walk_clip.playback_rate",
        },
        operation: "multiply",
        value: 8,
      },
    ],
  };
  return { base, variant };
}

test("variant preview scales only named insects, once, without mutating base or delta", () => {
  const { base, variant } = fixture();
  const before = component_document_json(base),
    delta = JSON.stringify(variant);
  const result = preview_component_variant(base, variant, 12);
  assert.equal(result.document.objects[0].motion.speed_mps, 0.048);
  assert.deepEqual(result.document.objects[1], base.objects[1]);
  assert.deepEqual(result.clip_rates, { [base.objects[0].id]: 8 });
  assert.equal(result.document.animation_speed, 0.125);
  assert.deepEqual(
    sample_component_motion(result.document.objects[0], 0.1),
    sample_component_motion(base.objects[0], 0.8),
  );
  assert.deepEqual(preview_component_variant(base, variant, 12), result);
  assert.equal(component_document_json(base), before);
  assert.equal(JSON.stringify(variant), delta);
});

test("variant preview rejects other bases, missing targets, duplicates and unsupported or unsafe overrides", () => {
  const { base, variant } = fixture();
  assert.throws(() => preview_component_variant(base, variant, 13));
  for (const mutate of [
    (v) => (v.base.component_id = randomUUID()),
    (v) => (v.role_groups.walking_insects = randomUUID()),
    (v) => v.overrides.push(v.overrides[0]),
    (v) => (v.overrides[0].target.property = "position"),
    (v) => (v.overrides[0].value = 100000),
    (v) => (v.overrides[1].value = -1),
  ]) {
    const changed = structuredClone(variant);
    mutate(changed);
    assert.throws(() => preview_component_variant(base, changed, 12));
  }
});

test("variant can replace its insect route without changing the base or accepting executable algorithms", () => {
  const { base, variant } = fixture();
  variant.overrides.push({
    target: { role: "walking_insects", property: "motion.algorithm" },
    operation: "replace",
    value: "facing-wander-v1",
  });
  const preview = preview_component_variant(base, variant, 12);
  assert.equal(
    preview.document.objects[0].motion.algorithm,
    "facing-wander-v1",
  );
  assert.equal(
    preview.document.objects[1].motion.algorithm,
    "facing-patrol-v1",
  );
  assert.equal(base.objects[0].motion.algorithm, "facing-patrol-v1");
  for (const override of [
    { operation: "multiply", value: 8 },
    { operation: "replace", value: "script" },
  ]) {
    const bad = structuredClone(variant);
    Object.assign(bad.overrides.at(-1), override);
    assert.throws(
      () => preview_component_variant(base, bad, 12),
      /invalid_component_variant/,
    );
  }
});
