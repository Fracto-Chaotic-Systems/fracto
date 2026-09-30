import assert from "node:assert/strict";
import { test } from "node:test";

import { create_windowed_metrics } from "../utils/windowed_metrics.js";

test("windowed metrics aggregate duration and outcomes without request details", () => {
  const records = [];
  const metrics = create_windowed_metrics({
    window_ms: 60_000,
    write: (line) => records.push(JSON.parse(line)),
  });

  metrics.record("canvas_buffer_request", 40, 200);
  metrics.record("canvas_buffer_request", 120, 503);
  metrics.record("auth_user_record_lookup", 18, "success");
  metrics.flush();
  metrics.stop();

  assert.equal(records.length, 2);
  const canvas = records.find((record) => record.metric === "canvas_buffer_request");
  assert.equal(canvas.count, 2);
  assert.equal(canvas.duration_ms_total, 160);
  assert.equal(canvas.duration_ms_average, 80);
  assert.equal(canvas.duration_ms_max, 120);
  assert.deepEqual(canvas.outcomes, { "200": 1, "503": 1 });

  const lookup = records.find((record) => record.metric === "auth_user_record_lookup");
  assert.equal(lookup.count, 1);
  assert.deepEqual(lookup.outcomes, { success: 1 });
  assert.equal(JSON.stringify(records).includes("cookie"), false);
  assert.equal(JSON.stringify(records).includes("provider_subject"), false);
});

test("windowed metrics reject dynamic names and outcome labels", () => {
  const records = [];
  const metrics = create_windowed_metrics({
    window_ms: 60_000,
    write: (line) => records.push(JSON.parse(line)),
  });

  metrics.record("user-42@example.com", 5, "token=secret");
  metrics.record("canvas_buffer_request", 5, "token=secret");
  metrics.flush();
  metrics.stop();

  assert.equal(records.length, 1);
  assert.equal(records[0].metric, "canvas_buffer_request");
  assert.deepEqual(records[0].outcomes, { other: 1 });
});
