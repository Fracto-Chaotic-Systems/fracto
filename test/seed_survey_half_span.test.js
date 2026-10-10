import assert from "node:assert/strict";
import test from "node:test";

import {
  calculate_seed_survey,
  create_seed_survey_start_handler,
  handle_seed_survey_job,
  start_seed_survey_job,
} from "../servers/fracto-data-server/handlers/handle_orbital.js";

test("seed-survey start handler forwards a bounded iteration limit", () => {
  let received_options;
  let response_code;
  let response_body;
  const handler = create_seed_survey_start_handler((_parameter, options) => {
    received_options = options;
    return { job_id: "limit-test" };
  });
  const response = {
    status(code) { response_code = code; return this; },
    json(body) { response_body = body; return this; },
  };
  handler({
    query: {
      re: "1",
      im: "0",
      resolution: "121",
      half_span: "0.5",
      iteration_limit: "1000000000",
    },
  }, response);

  assert.equal(response_code, 200);
  assert.equal(received_options.iteration_limit, 1_000_000_000);
  assert.deepEqual(response_body.result, { job_id: "limit-test" });
});

test("seed-survey start handler rejects limits outside the slider range", () => {
  let response_code;
  const handler = create_seed_survey_start_handler(() => {
    throw new Error("invalid limit should not start a job");
  });
  const response = {
    status(code) { response_code = code; return this; },
    json() { return this; },
  };
  handler({ query: { re: "1", im: "0", iteration_limit: "99999" } }, response);
  assert.equal(response_code, 400);
});

test("seed survey uses the selected half-span for both coordinate axes", () => {
  let first_seed;
  let last_seed;
  let samples = 0;
  const result = calculate_seed_survey(
    { x: 0.5, y: 0.5 },
    (_parameter, options) => {
      const seed = options.seed;
      if (samples === 0) first_seed = { ...seed };
      last_seed = { ...seed };
      samples++;
      return { pattern: 0, iteration: 1 };
    },
    () => {},
    { half_span: 2 },
  );

  assert.equal(samples, 121 * 121);
  assert.deepEqual(first_seed, { re: "-2.000000000000", im: "2.000000000000" });
  assert.deepEqual(last_seed, { re: "2.000000000000", im: "-2.000000000000" });
  assert.equal(result.half_span, 2);
  assert.equal(result.real_min, -2);
  assert.equal(result.real_max, 2);
  assert.equal(result.imaginary_min, -2);
  assert.equal(result.imaginary_max, 2);
  assert.equal(result.step, 4 / 120);
});

test("seed survey accepts the slider's smallest half-span", () => {
  const half_span = 2 ** -11;
  const result = calculate_seed_survey(
    { x: 0.5, y: 0.5 },
    () => ({ pattern: 0, iteration: 1 }),
    () => {},
    { half_span },
  );

  assert.equal(result.half_span, half_span);
  assert.equal(result.real_min, -half_span);
  assert.equal(result.imaginary_max, half_span);
});

test("outside-cardioid preview returns pattern/iteration pairs for every seed", () => {
  const progress_rows = [];
  let observed_limit;
  const result = calculate_seed_survey(
    { x: 1, y: 0 },
    (_parameter, options) => {
      observed_limit = options.seed_iteration_limit;
      return {
        pattern: Number(options.seed.re) > 0 ? 7 : 0,
        iteration: Number(options.seed.im) > 0 ? 23 : 9,
      };
    },
    (progress) => {
      if (progress.canvas_buffer_row) {
        progress_rows.push(progress.canvas_buffer_row);
      }
    },
    { iteration_limit: 250000 },
  );

  assert.equal(result.uses_canvas_buffer, true);
  assert.equal(result.canvas_buffer.length, 121);
  assert.ok(result.canvas_buffer.every((column) => column.length === 121));
  assert.deepEqual(result.canvas_buffer[0][0], [0, 23]);
  assert.deepEqual(result.canvas_buffer[120][120], [7, 9]);
  assert.equal(progress_rows.length, 121);
  assert.equal(progress_rows[0].values.length, 121);
  assert.equal(observed_limit, 250000);
  assert.equal(result.iteration_limit, 250000);
});

test("outside-cardioid render streams pattern/iteration rows for shared rendering", () => {
  let first_row;
  const result = calculate_seed_survey(
    { x: 1, y: 0 },
    () => ({ pattern: 7, iteration: 33 }),
    (progress) => {
      if (progress.render_row === 0) first_row = progress.render_row_data;
    },
    { resolution: 1024 },
  );

  assert.equal(result.uses_canvas_buffer, true);
  assert.equal(result.render_mode, true);
  assert.ok(first_row instanceof Uint8Array);
  const view = new DataView(first_row.buffer, first_row.byteOffset, first_row.byteLength);
  assert.equal(view.getUint8(0), 5);
  assert.equal(view.getUint32(1, true), 7);
  assert.equal(view.getUint32(9, true), 33);
});

test("in-cardioid preview does not use the shared canvas-buffer coloration", () => {
  const result = calculate_seed_survey(
    { x: 0, y: 0 },
    () => ({ pattern: 2, iteration: 25, orbital_points: [{ x: 0.2, y: 0.1 }, { x: 0.3, y: 0.2 }] }),
  );

  assert.equal(result.uses_canvas_buffer, false);
  assert.equal(result.canvas_buffer, null);
});

test("outside-cardioid survey jobs stream canvas-buffer rows by cursor", async () => {
  let worker_callbacks;
  let worker_payload;
  let finish_worker;
  const worker_task = new Promise((resolve) => {
    finish_worker = resolve;
  });
  worker_task.task_id = "test-seed-survey";
  const worker_pool = {
    run: (_task_name, payload, _transfer, callbacks) => {
      worker_payload = payload;
      worker_callbacks = callbacks;
      return worker_task;
    },
  };
  const started = start_seed_survey_job(
    { x: 1, y: 0 },
    { worker_pool, iteration_limit: 400000 },
  );
  const first_row = Array.from({ length: 121 }, () => [0, 17]);
  worker_callbacks.on_progress({
    completed: 121,
    total: 121 * 121,
    stable_points: [],
    iteration_points: [],
    unresolved_points: [],
    escaped_points: [],
    canvas_buffer_row: { row_index: 0, values: first_row },
  });
  let response_body;
  const response = {
    status: () => response,
    json: (body) => { response_body = body; return response; },
  };
  handle_seed_survey_job(
    { params: { job_id: started.job_id }, query: { after_row: "0" } },
    response,
  );

  assert.equal(response_body.uses_canvas_buffer, true);
  assert.equal(response_body.iteration_limit, 400000);
  assert.equal(worker_payload.iteration_limit, 400000);
  assert.equal(response_body.canvas_buffer_batch.row_start, 0);
  assert.equal(response_body.canvas_buffer_batch.row_count, 1);
  assert.deepEqual(response_body.canvas_buffer_batch.rows[0].values[0], [0, 17]);
  finish_worker({ total_samples: 121 * 121, canvas_buffer: [] });
  await worker_task;
  await Promise.resolve();
});
