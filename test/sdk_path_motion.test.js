import assert from "node:assert/strict";
import test from "node:test";
import {
  create_path_motion_controller,
  validate_path_motion,
} from "@fracto/sdk/FractoPathMotion.js";
const route = () => ({
  schema_version: 1,
  algorithm: "polyline-ping-pong-v1",
  units: "m",
  points: [
    [0, 0, 9],
    [0, 0, -9],
  ],
  speed_mps: 1,
  ramp_seconds: 2,
  pause_seconds: 2,
  turn_seconds: 6,
});
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test("path eases to a stop, pauses, turns in place, returns and loops without pose jumps", () => {
  const motion = create_path_motion_controller(route());
  assert.equal(motion.travel_seconds, 20);
  assert.equal(motion.leg_seconds, 28);
  const start = motion.pose;
  assert.deepEqual(start.position, [0, 0, 9]);
  assert.equal(start.speed_mps, 0);
  close(motion.sample(1).speed_mps, 0.5);
  close(motion.sample(19).speed_mps, 0.5);
  const stop = motion.sample(20),
    pause = motion.sample(21),
    turn = motion.sample(25),
    back = motion.sample(28);
  for (const p of [stop, pause, turn, back])
    assert.deepEqual(p.position, [0, 0, -9]);
  assert.equal(pause.phase, "pause");
  assert.equal(turn.phase, "turn");
  assert.equal(turn.speed_mps, 0);
  close(Math.abs(turn.heading_radians - pause.heading_radians), Math.PI / 2);
  close(Math.cos(back.heading_radians - pause.heading_radians), -1);
  assert.equal(back.direction, -1);
  assert.ok(motion.sample(35).position[2] > -9);
  const loop = motion.sample(motion.cycle_seconds);
  assert.deepEqual(loop, start);
  for (const t of [20, 22, 28, 48, 50, 56]) {
    const a = motion.sample(t - 1e-6),
      b = motion.sample(t + 1e-6);
    assert.ok(
      Math.hypot(...a.position.map((v, i) => v - b.position[i])) < 1e-4,
    );
    assert.ok(Math.cos(a.heading_radians - b.heading_radians) > 0.999999);
  }
});

test("controller is deterministic, independent of model clocks and handles short paths and multiple segments", () => {
  const data = route(),
    original = structuredClone(data),
    a = create_path_motion_controller(data),
    b = create_path_motion_controller(data);
  data.points[0][0] = 50;
  for (let i = 0; i < 100; i++) a.advance(0.1);
  b.advance(10);
  close(a.pose.position[2], b.pose.position[2]);
  assert.deepEqual(original, route());
  a.reset(25);
  assert.equal(a.pose.phase, "turn");
  const short = create_path_motion_controller({
    ...route(),
    points: [
      [0, 0, 0],
      [0.1, 0, 0],
    ],
    ramp_seconds: 10,
  });
  close(short.travel_seconds, 0.2);
  close(short.sample(0.1).position[0], 0.05);
  const poly = create_path_motion_controller({
    ...route(),
    points: [
      [3, 2, 4],
      [5, 2, 4],
      [5, 2, 7],
    ],
    ramp_seconds: 0,
  });
  assert.deepEqual(poly.sample(3).position, [5, 2, 5]);
  assert.deepEqual(poly.sample(poly.leg_seconds + 3).position, [5, 2, 4]);
  for (const time of [-1, NaN, Infinity]) assert.throws(() => a.advance(time));
});

test("path descriptions reject unknown shapes, nonplanar or duplicate points and unsafe rates", () => {
  assert.deepEqual(validate_path_motion(route()), route());
  for (const patch of [
    { extra: true },
    {
      points: [
        [0, 0, 0],
        [0, 0, 0],
      ],
    },
    {
      points: [
        [0, 0, 0],
        [1, 1, 0],
      ],
    },
    { speed_mps: 0 },
    { turn_seconds: 0 },
    { pause_seconds: -1 },
    { ramp_seconds: Infinity },
    { units: "cm" },
    { algorithm: "other" },
  ])
    assert.throws(() => validate_path_motion({ ...route(), ...patch }));
});
