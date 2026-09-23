import assert from "node:assert/strict";
import test from "node:test";

import FractoCanvasBuffer from "../sdk/FractoCanvasBuffer.js";

const create_context = () => {
  const calls = [];
  let fill_style = null;
  return {
    calls,
    get fillStyle() {
      return fill_style;
    },
    set fillStyle(value) {
      fill_style = value;
    },
    fillRect(x, y, width, height) {
      calls.push({
        fill_style,
        x,
        y,
        width,
        height,
      });
    },
  };
};

test("FractoCanvasBuffer safely ignores an empty buffer", () => {
  const context = create_context();

  assert.doesNotThrow(() => {
    FractoCanvasBuffer.buffer_to_canvas(null, context);
    FractoCanvasBuffer.buffer_to_canvas([], context);
  });
  assert.equal(context.calls.length, 0);
});

test("FractoCanvasBuffer renders pattern and non-pattern pixels", () => {
  const context = create_context();
  const canvas_buffer = [[[0, 2]], [[3, 4]]];

  FractoCanvasBuffer.buffer_to_canvas(canvas_buffer, context, 2);

  assert.equal(context.calls.length, 2);
  assert.deepEqual(
    context.calls.map(({ x, y, width, height }) => ({ x, y, width, height })),
    [
      { x: 0, y: 0, width: 3, height: 3 },
      { x: 2, y: 0, width: 3, height: 3 },
    ],
  );
  assert.match(context.calls[0].fill_style, /^rgb\(/);
  assert.match(context.calls[1].fill_style, /^hsl\(/);
});

test("FractoCanvasBuffer colors deselected heat-map levels cyan", () => {
  const context = create_context();
  const canvas_buffer = [[[0, 1]], [[0, 2]]];

  FractoCanvasBuffer.buffer_to_canvas(canvas_buffer, context, 1, true, [1]);

  assert.equal(context.calls.length, 2);
  assert.notEqual(context.calls[0].fill_style, "#d9ffff");
  assert.equal(context.calls[1].fill_style, "#d9ffff");
});
