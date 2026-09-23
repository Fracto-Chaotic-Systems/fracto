import FractoColors, { GREY_BASE, GREY_RANGE } from "./FractoColors.js";

const COLOR_LUM_BASE_PCT = 15;
const COLOR_LUM_BASE_RANGE_PCT = 40;

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
  static buffer_to_canvas = (
    canvas_buffer,
    ctx,
    scale_factor = 1,
    heat_map = false,
    selected_levels = null,
  ) => {
    if (!canvas_buffer || !ctx) {
      console.log("!canvas_buffer || !ctx", ctx);
      return;
    }
    const all_not_pattern_pixels = [];
    const all_inner_pattern_pixels = [];
    const all_outer_pattern_pixels = [];
    const all_not_pattern_sets = {};
    const all_inner_pattern_sets = {};
    const all_outer_pattern_sets = {};
    for (let canvas_x = 0; canvas_x < canvas_buffer.length; canvas_x++) {
      const col = canvas_buffer[canvas_x];
      for (let canvas_y = 0; canvas_y < col.length; canvas_y++) {
        const point_data = col[canvas_y];
        if (!point_data) {
          continue;
        }
        const key = `_${Math.abs(point_data[1])}`;
        if (point_data[0] === 0) {
          all_not_pattern_sets[key] = (all_not_pattern_sets[key] || 0) + 1;
          all_not_pattern_pixels.push({
            iteration: point_data[1],
            canvas_x,
            canvas_y,
          });
        } else if (point_data[0] < 0) {
          all_inner_pattern_sets[key] = (all_inner_pattern_sets[key] || 0) + 1;
          all_inner_pattern_pixels.push({
            pattern: Math.abs(point_data[0]),
            iteration: Math.abs(point_data[1]),
            canvas_x,
            canvas_y,
          });
        } else {
          all_outer_pattern_sets[key] = (all_outer_pattern_sets[key] || 0) + 1;
          all_outer_pattern_pixels.push({
            pattern: Math.abs(point_data[0]),
            iteration: Math.abs(point_data[1]),
            canvas_x,
            canvas_y,
          });
        }
      }
    }

    const not_pattern_greys_map = heat_map
      ? FractoColors.get_heat_map_greys_map(canvas_buffer)
      : FractoColors.get_greys_map(
          all_not_pattern_pixels,
          all_not_pattern_sets,
          GREY_BASE,
          GREY_RANGE,
        );
    const inner_pattern_greys_map = FractoColors.get_greys_map(
      all_inner_pattern_pixels,
      all_inner_pattern_sets,
      COLOR_LUM_BASE_PCT,
      COLOR_LUM_BASE_RANGE_PCT,
    );
    const outer_pattern_greys_map = FractoColors.get_greys_map(
      all_outer_pattern_pixels,
      all_outer_pattern_sets,
      COLOR_LUM_BASE_PCT,
      COLOR_LUM_BASE_RANGE_PCT,
    );

    const pixel_size = 1.5 * scale_factor;
    for (let i = 0; i < all_not_pattern_pixels.length; i++) {
      const pixel = all_not_pattern_pixels[i];
      if (
        heat_map &&
        Array.isArray(selected_levels) &&
        !selected_levels.includes(Math.abs(pixel.iteration))
      ) {
        ctx.fillStyle = "#d9ffff";
        ctx.fillRect(
          scale_factor * pixel.canvas_x,
          scale_factor * pixel.canvas_y,
          pixel_size,
          pixel_size,
        );
        continue;
      }
      const key = `_${pixel.iteration}`;
      const grey_value = not_pattern_greys_map[key];
      ctx.fillStyle = `rgb(${grey_value},${grey_value},${grey_value})`;
      ctx.fillRect(
        scale_factor * pixel.canvas_x,
        scale_factor * pixel.canvas_y,
        pixel_size,
        pixel_size,
      );
    }
    for (let i = 0; i < all_inner_pattern_pixels.length; i++) {
      const pixel = all_inner_pattern_pixels[i];
      const key = `_${Math.abs(pixel.iteration)}`;
      const lum_factor = inner_pattern_greys_map[key];
      const hue = FractoColors.pattern_hue(pixel.pattern);
      ctx.fillStyle = `hsl(${hue}, 80%, ${100 - lum_factor}%)`;
      ctx.fillRect(
        scale_factor * pixel.canvas_x,
        scale_factor * pixel.canvas_y,
        pixel_size,
        pixel_size,
      );
    }
    for (let i = 0; i < all_outer_pattern_pixels.length; i++) {
      const pixel = all_outer_pattern_pixels[i];
      const key = `_${Math.abs(pixel.iteration)}`;
      const lum_factor = outer_pattern_greys_map[key];
      const hue = FractoColors.pattern_hue(pixel.pattern);
      ctx.fillStyle = `hsl(${hue}, 80%, ${100 - lum_factor}%)`;
      ctx.fillRect(
        scale_factor * pixel.canvas_x,
        scale_factor * pixel.canvas_y,
        pixel_size,
        pixel_size,
      );
    }
  };
}

export default FractoCanvasBuffer;
