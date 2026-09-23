import FractoUtil from "./FractoUtil.js";

const MAX_PATTERN = 20000;
export const GREY_BASE = 50;
export const GREY_RANGE = 255 - GREY_BASE;
const COLOR_LUM_BASE_PCT = 15;
const COLOR_LUM_BASE_RANGE_PCT = 40;

export const FRACTO_COLOR_ITERATIONS = 200;

export class FractoColors {
  static pattern_hues = null;

  static init_pattern_hues = () => {
    // Precompute log2 values for better performance
    const pattern_hues = new Array(MAX_PATTERN);
    pattern_hues[0] = 0;
    for (let pattern = 1; pattern < MAX_PATTERN; pattern++) {
      const log2 = Math.log2(pattern);
      pattern_hues[pattern] = Math.floor(360 * (log2 - Math.floor(log2)));
    }
    FractoColors.pattern_hues = pattern_hues;
  };

  static pattern_hue = (pattern) => {
    if (!FractoColors.pattern_hues) {
      FractoColors.init_pattern_hues();
    }
    let pattern_in_range = pattern;
    while (pattern_in_range > MAX_PATTERN) {
      pattern_in_range = Math.floor(pattern_in_range / 2);
    }
    return FractoColors.pattern_hues[pattern_in_range];
  };

  static pattern_color_hsl = (pattern, iteration) => {
    return FractoUtil.fracto_pattern_color_hsl(pattern, iteration);
  };

  static get_greys_map = (
    all_pixels,
    all_sets_object,
    base_value,
    range_value,
  ) => {
    const total_pixels = all_pixels.length;
    // Convert object to sorted array only once
    const all_sets = Object.keys(all_sets_object)
      .map((key) => {
        const iteration = parseInt(key.slice(1));
        return { iteration, iteration_count: all_sets_object[key] };
      })
      .sort((a, b) => a.iteration - b.iteration);
    let best_bin_size = total_pixels / range_value;
    let current_grey_tone = base_value + range_value;
    let current_bin_size = 0;
    let total_pixel_count = 0;
    for (let i = 0; i < all_sets.length; i++) {
      const set = all_sets[i];
      if (set.iteration_count > best_bin_size) {
        let reduce_by = Math.floor(set.iteration_count / best_bin_size);
        const threshhold = (current_grey_tone - base_value) / 10;
        if (reduce_by > threshhold) {
          reduce_by = Math.round(threshhold) + 1;
        }
        current_grey_tone -= reduce_by;
        current_bin_size = 0;
      } else if (set.iteration_count + current_bin_size < best_bin_size) {
        current_bin_size += set.iteration_count;
      } else {
        current_bin_size = set.iteration_count;
        current_grey_tone -= 1;
      }
      total_pixel_count += set.iteration_count;
      set.grey_tone = current_grey_tone;
      const remaining_bins = current_grey_tone - base_value + 1;
      best_bin_size = (total_pixels - total_pixel_count) / remaining_bins;
    }
    const greys_map = {};
    for (let i = 0; i < all_sets.length; i++) {
      const set = all_sets[i];
      greys_map[`_${set.iteration}`] = set.grey_tone;
    }
    return greys_map;
  };

  /**
   * Creates the same bounded heat-map palette used by the UI renderer.
   * Levels are assigned from light to dark in ascending level order.
   */
  static get_heat_map_greys_palette = (shade_count) => {
    const count = Math.max(0, Math.floor(Number(shade_count) || 0));
    if (!count) {
      return [];
    }
    const min_grey = 255 * 0.25;
    const max_grey = 255 * 0.95;
    const step = (max_grey - min_grey) / (count + 1);
    return Array.from({ length: count }, (_, index) =>
      Math.round(max_grey - step * (index + 1)),
    );
  };

  /**
   * Assigns bounded heat-map shades to levels present in a canvas buffer.
   */
  static get_heat_map_greys_map = (canvas_buffer) => {
    const levels = new Set();
    for (const column of canvas_buffer || []) {
      for (const point of column || []) {
        if (point) {
          levels.add(Math.abs(point[1] || 0));
        }
      }
    }
    const sorted_levels = Array.from(levels).sort(
      (left, right) => left - right,
    );
    if (!sorted_levels.length) {
      return {};
    }
    const palette = FractoColors.get_heat_map_greys_palette(
      sorted_levels.length,
    );
    return Object.fromEntries(
      sorted_levels.map((level, index) => [`_${level}`, palette[index]]),
    );
  };
}

export default FractoColors;
