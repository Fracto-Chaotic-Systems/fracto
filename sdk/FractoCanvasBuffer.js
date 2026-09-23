import FractoColors from "./FractoColors.js";

/**
 * Framework-neutral canvas-buffer renderer.
 *
 * The implementation intentionally accepts only a server buffer and a
 * canvas-like 2D context. Application settings, network requests, and React
 * state belong to adapters outside the SDK.
 */
export class FractoCanvasBuffer {
  /**
   * Converts a pattern/iteration buffer into colored pixels.
   *
   * @param {Array} canvas_buffer server-produced pattern/iteration buffer
   * @param {CanvasRenderingContext2D} ctx target canvas-like context
   * @param {number} scale_factor output pixel scale
   * @param {boolean} heat_map use heat-map level colors
   * @param {Array<number>|null} selected_levels levels retained in a heat map
   * @returns {void}
   */
  static buffer_to_canvas = (...args) => FractoColors.buffer_to_canvas(...args);
}

export default FractoCanvasBuffer;
