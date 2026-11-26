import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  create_component_document,
  validate_component_document,
  component_document_json,
  create_component_history,
  edit_component_history,
  undo_component_history,
  redo_component_history,
} from "@fracto/sdk/FractoComponentDocument.js";
import {
  sample_component_motion,
  component_motion_bounds,
} from "@fracto/sdk/FractoComponentMotion.js";

test("heading-varied paths are continuous, face travel, retain speed and stay in their bounded local shelter", () => {
  for (const yaw of [0, 0.4, Math.PI / 2, Math.PI, 5.7]) {
    const object = {
      id: `ladybug-${yaw}`,
      position: [0.2, -0.0048, 3],
      rotation: [0, yaw, 0],
      motion: {
        algorithm: "facing-wander-v1",
        speed_mps: 0.05,
        distance_m: 0.04,
      },
    };
    const original = structuredClone(object),
      bounds = component_motion_bounds(object),
      headings = new Set();
    let previous = sample_component_motion(object, 0);
    for (let t = 0.037; t < 100; t += 0.037) {
      const pose = sample_component_motion(object, t);
      const next = sample_component_motion(object, t + 0.00001);
      const dx = pose.position[0] - object.position[0],
        dz = pose.position[2] - object.position[2];
      const x = (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / 0.04;
      const z = (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / 0.04;
      assert.ok((x / 0.25) ** 2 + ((z - 0.5) / 0.5) ** 2 <= 1 + 1e-10);
      assert.equal(pose.position[1], object.position[1]);
      for (const axis of [0, 2])
        assert.ok(
          pose.position[axis] >= bounds.min[axis] - 1e-10 &&
            pose.position[axis] <= bounds.max[axis] + 1e-10,
        );
      assert.ok(
        Math.hypot(
          pose.position[0] - previous.position[0],
          pose.position[2] - previous.position[2],
        ) <=
          0.05 * 0.037 + 1e-10,
        "No teleport at a heading change or circuit seam",
      );
      headings.add(pose.rotation[1].toFixed(5));
      if (Math.abs(pose.rotation[1] - next.rotation[1]) < 1e-8) {
        const vx = next.position[0] - pose.position[0],
          vz = next.position[2] - pose.position[2];
        assert.ok(Math.abs(Math.hypot(vx, vz) - 0.05 * 0.00001) < 1e-10);
        assert.ok(
          vx * Math.sin(pose.rotation[1]) + vz * Math.cos(pose.rotation[1]) > 0,
        );
        assert.ok(
          Math.abs(
            vx * Math.cos(pose.rotation[1]) - vz * Math.sin(pose.rotation[1]),
          ) < 1e-10,
          "Bug faces its velocity",
        );
      }
      previous = pose;
    }
    assert.ok(
      headings.size >= 6,
      "Multiple headings, not two directions along one line",
    );
    assert.deepEqual(
      sample_component_motion(object, 2),
      sample_component_motion(structuredClone(object), 2),
    );
    assert.notDeepEqual(
      sample_component_motion(object, 2),
      sample_component_motion({ ...object, id: object.id + "-other" }, 2),
    );
    assert.deepEqual(object, original);
  }
});
test("persisted forward patrols move at authored speed and turn to face the return leg", () => {
  const d = create_component_document(randomUUID(), "Insects");
  const o = {
    id: randomUUID(),
    asset: { id: "ladybug", revision: "a".repeat(64) },
    position: [0.3, 0.0001, -9.5],
    rotation: [0, Math.PI / 3, 0],
    scale: [1.5, 1.5, 1.5],
    group_id: null,
    motion: {
      algorithm: "facing-patrol-v1",
      speed_mps: 0.0064,
      distance_m: 0.032,
    },
  };
  d.objects.push(o);
  d.animation_speed = 0.125;
  assert.deepEqual(
    JSON.parse(component_document_json(d)),
    JSON.parse(JSON.stringify(d)),
  );
  for (const t of [0, 1, 4.99, 5.01, 7, 9.99, 10, 1000]) {
    const a = sample_component_motion(o, t),
      b = sample_component_motion(o, t + 0.0001);
    const delta = [
      b.position[0] - a.position[0],
      b.position[2] - a.position[2],
    ];
    assert.ok(
      delta[0] * Math.sin(a.rotation[1]) + delta[1] * Math.cos(a.rotation[1]) >
        0,
    );
    assert.ok(Math.abs(Math.hypot(...delta) - 0.00000064) < 1e-12);
    assert.equal(a.position[1], o.position[1]);
    assert.ok(
      Math.hypot(
        a.position[0] - o.position[0],
        a.position[2] - o.position[2],
      ) <=
        0.032 + 1e-12,
    );
  }
  const history = edit_component_history(
    create_component_history({ ...d, objects: [] }),
    d,
  );
  assert.equal(undo_component_history(history).present.objects.length, 0);
  assert.deepEqual(
    redo_component_history(undo_component_history(history)).present,
    d,
  );
  for (const motion of [
    null,
    { ...o.motion, extra: true },
    { ...o.motion, speed_mps: -1 },
    { ...o.motion, speed_mps: Infinity },
    { ...o.motion, distance_m: 0 },
    { ...o.motion, algorithm: "script" },
  ])
    assert.throws(() =>
      validate_component_document({ ...d, objects: [{ ...o, motion }] }),
    );
});
