import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  create_component_document,
  validate_component_document,
  create_component_history,
  edit_component_history,
  undo_component_history,
  redo_component_history,
} from "@fracto/sdk/FractoComponentDocument.js";
import {
  apply_component_commands,
  component_reference_key,
} from "@fracto/sdk/FractoComponentTools.js";
import { empty_material_construction } from "@fracto/sdk/FractoMaterialMetadata.js";
import {
  generate_component_scatter,
  COMPONENT_SCATTER_ALGORITHM,
} from "@fracto/sdk/FractoComponentScatter.js";
const asset = { id: "tree", revision: "a".repeat(64) };
const facts = {
  ...empty_material_construction(),
  kind: "model",
  placement: "ground",
  meters_per_unit: 1,
  dimensions_m: [1, 3, 2],
  ground_anchor_m: [0, 0, 0],
  up_axis: "y",
  forward_axis: "z",
  footprint_m: [1, 2],
};
const materials = {
  [component_reference_key(asset)]: {
    material: { ...asset, construction: facts },
    runtime: { resources: ["tree.glb"] },
  },
};
const object = () => ({
  id: randomUUID(),
  asset,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  group_id: null,
});
const scatter = () => ({
  id: randomUUID(),
  asset,
  group_id: null,
  seed: 1234,
  count: 30,
  bounds: [-10, -10, 10, 10],
  scale: [0.8, 1.2],
  exclusions: [[-2, -10, 2, 10]],
  algorithm: COMPONENT_SCATTER_ALGORITHM,
});

test("explicit patterns expand atomically with exact instance shapes and shared live pins", () => {
  const initial = create_component_document(randomUUID(), "Dense cover");
  const instances = Array.from({ length: 809 }, () => {
    const { id, position, rotation, scale } = object();
    return { id, position, rotation, scale };
  });
  const pattern = { type: "place-pattern", asset, instances };
  const result = apply_component_commands(initial, [pattern], materials);
  assert.equal(result.objects.length, 809);
  assert.deepEqual(result.objects[0], {
    ...instances[0],
    asset,
    group_id: null,
  });
  assert.throws(() => apply_component_commands(initial, [pattern], {}));
  assert.throws(() =>
    apply_component_commands(
      initial,
      [{ ...pattern, instances: [] }],
      materials,
    ),
  );
  assert.throws(() =>
    apply_component_commands(
      initial,
      [{ ...pattern, instances: [{ ...instances[0], group_id: null }] }],
      materials,
    ),
  );
  assert.throws(() =>
    apply_component_commands(
      initial,
      [{ ...pattern, instances: [instances[0], instances[0]] }],
      materials,
    ),
  );
  assert.throws(() =>
    apply_component_commands(
      initial,
      [pattern, { ...pattern, instances: instances.slice(0, 200) }],
      materials,
    ),
  );
  assert.deepEqual(initial.objects, []);
});
test("a construction batch is atomic, roundtrips and has one undo step", () => {
  const initial = create_component_document(randomUUID(), "Path"),
    tree = object(),
    rule = scatter();
  const result = apply_component_commands(
    initial,
    [
      {
        type: "set-floor",
        floor: {
          asset: null,
          size: [20, 20],
          texture_repeat: [1, 1],
          texture_file: null,
        },
      },
      { type: "place", object: tree },
      { type: "scatter", rule },
    ],
    materials,
  );
  assert.deepEqual(initial.objects, []);
  assert.equal(initial.floor, null);
  assert.deepEqual(
    validate_component_document(JSON.parse(JSON.stringify(result))),
    result,
  );
  let history = edit_component_history(
    create_component_history(initial),
    result,
  );
  assert.equal(history.past.length, 1);
  history = undo_component_history(history);
  assert.deepEqual(history.present, initial);
  history = redo_component_history(history);
  assert.deepEqual(history.present, result);
  const moved = apply_component_commands(result, [
    {
      type: "transform",
      id: tree.id,
      position: [1, 0, 2],
      rotation: [0, 1, 0],
      scale: [2, 1, 2],
    },
  ]);
  assert.deepEqual(moved.objects[0].position, [1, 0, 2]);
  assert.equal(
    apply_component_commands(moved, [{ type: "remove", id: rule.id }]).scatters
      .length,
    0,
  );
  assert.throws(() =>
    apply_component_commands(
      initial,
      [
        { type: "place", object: tree },
        { type: "remove", id: randomUUID() },
      ],
      materials,
    ),
  );
  assert.equal(initial.objects.length, 0);
});
test("tools reject uncalibrated/replaced assets, invalid transforms, unknown operations and resource paths", () => {
  const initial = create_component_document(randomUUID(), "Path");
  assert.throws(
    () =>
      apply_component_commands(initial, [{ type: "place", object: object() }]),
    /material_revision_changed/,
  );
  assert.throws(
    () =>
      apply_component_commands(initial, [{ type: "place", object: object() }], {
        [component_reference_key(asset)]: {
          material: { ...asset, construction: empty_material_construction() },
        },
      }),
    /material_not_calibrated/,
  );
  assert.throws(
    () =>
      apply_component_commands(
        initial,
        [{ type: "place", object: { ...object(), scale: [0, 1, 1] } }],
        materials,
      ),
    /invalid_component_document/,
  );
  assert.throws(
    () =>
      apply_component_commands(initial, [
        { type: "execute-code", script: "ignored" },
      ]),
    /invalid_construction_command/,
  );
  const surface = { id: "dirt", revision: "b".repeat(64) };
  const registry = {
    [component_reference_key(surface)]: {
      material: {
        ...surface,
        construction: {
          ...empty_material_construction(),
          kind: "surface",
          placement: "floor",
          texture_size_m: [2, 2],
        },
      },
      runtime: { resources: ["dirt.png"] },
    },
  };
  const floor = {
    asset: surface,
    size: [4, 12],
    texture_repeat: [2, 6],
    texture_file: "dirt.png",
  };
  assert.deepEqual(
    apply_component_commands(initial, [{ type: "set-floor", floor }], registry)
      .floor,
    floor,
  );
  assert.throws(
    () =>
      apply_component_commands(
        initial,
        [{ type: "set-floor", floor: { ...floor, texture_file: "other.png" } }],
        registry,
      ),
    /floor_texture_missing/,
  );
});
test("frozen seeded scatter regenerates identical footprints, respects exclusions and rejects impossible fills", () => {
  const rule = scatter(),
    first = generate_component_scatter(rule, facts);
  assert.deepEqual(first[0], {
    position: [-8.534100437536836, 0, 4.06823979690671],
    rotation: [0, 5.6728116736620535, 0],
    scale: [1.1882197464816273, 1.1882197464816273, 1.1882197464816273],
  });
  assert.deepEqual(
    generate_component_scatter(JSON.parse(JSON.stringify(rule)), facts),
    first,
  );
  assert.deepEqual(
    generate_component_scatter({ ...rule, algorithm: undefined }, facts),
    first,
  );
  assert.notDeepEqual(
    generate_component_scatter({ ...rule, seed: 1 }, facts),
    first,
  );
  for (const item of first) {
    const [x, , z] = item.position,
      angle = item.rotation[1],
      s = item.scale[0];
    const hx =
      ((Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle)) * 2) * s) / 2;
    const hz =
      ((Math.abs(Math.sin(angle)) + Math.abs(Math.cos(angle)) * 2) * s) / 2;
    assert.ok(x - hx >= -10 && x + hx <= 10 && z - hz >= -10 && z + hz <= 10);
    assert.ok(x + hx < -2 || x - hx > 2);
  }
  assert.throws(
    () =>
      generate_component_scatter(
        { ...rule, exclusions: [[-10, -10, 10, 10]] },
        facts,
      ),
    /scatter_cannot_fit/,
  );
  assert.throws(
    () =>
      generate_component_scatter({ ...rule, algorithm: "future-v2" }, facts),
    /scatter_cannot_fit/,
  );
  assert.throws(
    () =>
      apply_component_commands(
        create_component_document(randomUUID(), "Path"),
        [{ type: "scatter", rule: { ...rule, count: 1001 } }],
        materials,
      ),
    /invalid_component_document/,
  );
});

test("components support 128 distinct material pins and reject 129 without partial edits", () => {
  const make = (count) => {
    const d = create_component_document(randomUUID(), "Unique rocks");
    d.objects = Array.from({ length: count }, (_, i) => ({
      id: randomUUID(),
      asset: { id: "rock-" + i, revision: "a".repeat(64) },
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      group_id: null,
    }));
    return d;
  };
  for (const count of [88, 128]) {
    const d = make(count),
      o = d.objects[0];
    const next = apply_component_commands(d, [
      {
        type: "transform",
        id: o.id,
        position: o.position,
        rotation: o.rotation,
        scale: o.scale,
      },
    ]);
    assert.equal(next.objects.length, count);
  }
  const d = make(129),
    o = d.objects[0],
    before = JSON.stringify(d);
  assert.throws(
    () =>
      apply_component_commands(d, [
        {
          type: "transform",
          id: o.id,
          position: [1, 0, 0],
          rotation: o.rotation,
          scale: o.scale,
        },
      ]),
    /construction_limit/,
  );
  assert.equal(JSON.stringify(d), before);
});
