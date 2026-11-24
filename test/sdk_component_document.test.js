import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  create_component_document,
  component_document_json,
  validate_component_document,
  create_component_history,
  edit_component_history,
  undo_component_history,
  redo_component_history,
  COMPONENT_DESCRIPTION_LIMIT,
  component_lighting,
} from "@fracto/sdk/FractoComponentDocument.js";

test("lighting defaults persist, validate and participate in history without rewriting legacy scenes", () => {
  const base = create_component_document(randomUUID(), "Lighting");
  assert.deepEqual(base.lighting, { direction_degrees: 45, intensity: 3 });
  const changed = {
    ...base,
    lighting: { direction_degrees: 270, intensity: 0.75 },
  };
  assert.deepEqual(JSON.parse(component_document_json(changed)), changed);
  const history = edit_component_history(
    create_component_history(base),
    changed,
  );
  assert.deepEqual(undo_component_history(history).present, base);
  assert.deepEqual(
    redo_component_history(undo_component_history(history)).present,
    changed,
  );
  const legacy = { ...base };
  delete legacy.lighting;
  assert.deepEqual(component_lighting(legacy), base.lighting);
  assert.equal(
    Object.hasOwn(validate_component_document(legacy), "lighting"),
    false,
  );
  assert.equal(
    component_document_json(legacy),
    component_document_json(JSON.parse(component_document_json(legacy))),
  );
  for (const lighting of [
    null,
    {},
    { direction_degrees: -1, intensity: 3 },
    { direction_degrees: 361, intensity: 3 },
    { direction_degrees: NaN, intensity: 3 },
    { direction_degrees: 45, intensity: 0 },
    { direction_degrees: 45, intensity: 7 },
    { direction_degrees: 45, intensity: Infinity },
    { direction_degrees: 45, intensity: "3" },
    { direction_degrees: 45, intensity: 3, extra: true },
  ])
    assert.throws(() => validate_component_document({ ...base, lighting }));
  base.lighting.intensity = 1;
  assert.equal(
    create_component_document(randomUUID(), "Other").lighting.intensity,
    3,
  );
});

test("object clip speed persists as an independent clock without changing legacy objects", () => {
  const base = create_component_document(randomUUID(), "Sparse grass");
  base.animation_speed = 0.125;
  base.objects = [
    {
      id: randomUUID(),
      asset: { id: "animated-grass", revision: "a".repeat(64) },
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      group_id: null,
    },
  ];
  const legacy = component_document_json(base),
    changed = structuredClone(base);
  changed.objects[0].animation_speed = 1;
  assert.equal(
    JSON.parse(component_document_json(changed)).objects[0].animation_speed,
    1,
  );
  assert.equal(
    Object.hasOwn(
      validate_component_document(base).objects[0],
      "animation_speed",
    ),
    false,
  );
  assert.equal(component_document_json(base), legacy);
  const history = edit_component_history(
    create_component_history(base),
    changed,
  );
  assert.deepEqual(undo_component_history(history).present, base);
  assert.deepEqual(
    redo_component_history(undo_component_history(history)).present,
    changed,
  );
  for (const value of [-1, 11, NaN, Infinity, null, "1"])
    assert.throws(() =>
      validate_component_document({
        ...base,
        objects: [{ ...base.objects[0], animation_speed: value }],
      }),
    );
});

test("construction descriptions roundtrip and bind to scene history without altering legacy documents", () => {
  const legacy = create_component_document(randomUUID(), "Grass strip");
  const authored = {
    ...legacy,
    construction_description:
      "# Grass strip\n\nGrass with **interior openings**.\n\n<script>inert source text</script>",
  };
  assert.deepEqual(JSON.parse(component_document_json(authored)), authored);
  assert.notEqual(
    component_document_json(authored),
    component_document_json(legacy),
  );
  assert.equal(
    Object.hasOwn(
      validate_component_document(legacy),
      "construction_description",
    ),
    false,
  );
  const h = edit_component_history(create_component_history(legacy), authored);
  assert.deepEqual(undo_component_history(h).present, legacy);
  assert.deepEqual(
    redo_component_history(undo_component_history(h)).present,
    authored,
  );
  for (const value of [
    null,
    undefined,
    1,
    {},
    "x".repeat(COMPONENT_DESCRIPTION_LIMIT + 1),
    "bad\u0000text",
  ])
    assert.throws(() =>
      validate_component_document({
        ...legacy,
        construction_description: value,
      }),
    );
  assert.equal(
    validate_component_document({ ...legacy, construction_description: "" })
      .construction_description,
    "",
  );
  assert.equal(
    validate_component_document({
      ...legacy,
      construction_description: "x".repeat(COMPONENT_DESCRIPTION_LIMIT),
    }).construction_description.length,
    COMPONENT_DESCRIPTION_LIMIT,
  );
});

test("canonical document bytes ignore property order and validate without mutation", () => {
  const document = create_component_document(randomUUID(), "Canonical");
  const before = structuredClone(document);
  const reversed = Object.fromEntries(Object.entries(document).reverse());
  assert.equal(
    component_document_json(document),
    component_document_json(reversed),
  );
  assert.deepEqual(JSON.parse(component_document_json(document)), document);
  assert.deepEqual(document, before);
  assert.notEqual(
    component_document_json(document),
    component_document_json({ ...document, name: "Changed" }),
  );
  assert.throws(() => component_document_json({ ...document, units: "feet" }));
});

const fixture = () => {
  const document = create_component_document(randomUUID(), "Wooded path");
  const asset = { id: "grass", revision: "a".repeat(64) };
  const group_id = randomUUID();
  document.groups = [{ id: group_id, name: "Borders" }];
  document.floor = {
    asset: { ...asset, id: "dirt" },
    size: [4, 12],
    texture_repeat: [2, 6],
  };
  document.objects = [
    {
      id: randomUUID(),
      asset,
      position: [2, 0, 3],
      rotation: [0, 0.5, 0],
      scale: [1, 1, 1],
      group_id,
    },
  ];
  document.scatters = [
    {
      id: randomUUID(),
      asset,
      seed: 1234,
      count: 20,
      bounds: [-4, -6, 4, 6],
      exclusions: [[-1, -6, 1, 6]],
      scale: [0.8, 1.2],
      group_id,
    },
  ];
  return document;
};

test("component animation speed persists without changing legacy documents or hashes", () => {
  const document = fixture();
  const legacy = component_document_json(document);
  assert.equal(
    Object.hasOwn(validate_component_document(document), "animation_speed"),
    false,
  );
  for (const speed of [0, 0.25, 1, 10]) {
    const authored = { ...document, animation_speed: speed };
    assert.deepEqual(
      validate_component_document(
        JSON.parse(component_document_json(authored)),
      ),
      authored,
    );
    assert.notEqual(component_document_json(authored), legacy);
    const history = edit_component_history(
      create_component_history(document),
      authored,
    );
    assert.deepEqual(undo_component_history(history).present, document);
    assert.deepEqual(
      redo_component_history(undo_component_history(history)).present,
      authored,
    );
  }
  for (const invalid of [null, undefined, "0.25", -0.01, 10.01, NaN, Infinity])
    assert.throws(() =>
      validate_component_document({ ...document, animation_speed: invalid }),
    );
  assert.equal(component_document_json(document), legacy);
});
test("component document roundtrips all authored fields with isolated snapshots", () => {
  const document = fixture();
  const validated = validate_component_document(
    JSON.parse(JSON.stringify(document)),
  );
  assert.deepEqual(validated, document);
  validated.objects[0].position[0] = 99;
  assert.equal(document.objects[0].position[0], 2);
});
test("component contract rejects unsupported/unknown/unsafe and dangling content", () => {
  const mutations = [
    (d) => (d.schema_version = 2),
    (d) => (d.user_id = "excluded"),
    (d) => (d.units = "feet"),
    (d) => (d.name = " "),
    (d) => (d.objects[0].position[0] = Infinity),
    (d) => (d.objects[0].scale[1] = 0),
    (d) => (d.objects[0].group_id = randomUUID()),
    (d) => (d.scatters[0].id = d.objects[0].id),
    (d) => (d.scatters[0].seed = 1.5),
    (d) => (d.scatters[0].count = 1000),
    (d) => (d.scatters[0].bounds = [1, 1, 0, 0]),
    (d) => (d.floor.asset.id = "../dirt"),
    (d) => (d.floor.asset.revision = ""),
    (d) => (d.objects[0].asset.creator_name = "excluded"),
  ];
  for (const mutate of mutations) {
    const document = fixture();
    mutate(document);
    assert.throws(
      () => validate_component_document(document),
      /invalid_component_document/,
    );
  }
});
test("history restores whole batches, clears branched redo and bounds retained edits", () => {
  const initial = fixture();
  let history = create_component_history(initial);
  const next = structuredClone(initial);
  next.name = "Dense border";
  next.scatters[0].count = 40;
  history = edit_component_history(history, next);
  next.objects[0].scale[0] = 100;
  assert.equal(history.present.objects[0].scale[0], 1);
  history = undo_component_history(history);
  assert.deepEqual(history.present, initial);
  history = redo_component_history(history);
  assert.equal(history.present.scatters[0].count, 40);
  history = edit_component_history(undo_component_history(history), {
    ...initial,
    name: "Other",
  });
  assert.equal(history.future.length, 0);
  for (let i = 0; i < 150; i++)
    history = edit_component_history(history, {
      ...history.present,
      name: `Edit ${i}`,
    });
  assert.equal(history.past.length, 100);
  assert.equal(edit_component_history(history, history.present), history);
});
