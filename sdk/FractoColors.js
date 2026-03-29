import FractoUtil from "./FractoUtil.js";

const MAX_PATTERN = 20000;
const GREY_BASE = 50;
const GREY_RANGE = (255 - GREY_BASE);
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
   }

   static pattern_hue = (pattern) => {
      if (!FractoColors.pattern_hues) {
         FractoColors.init_pattern_hues();
      }
      let pattern_in_range = pattern;
      while (pattern_in_range > MAX_PATTERN) {
         pattern_in_range = Math.floor(pattern_in_range / 2);
      }
      return FractoColors.pattern_hues[pattern_in_range];
   }

   static pattern_color_hsl = (pattern, iteration) => {
      return FractoUtil.fracto_pattern_color_hsl(pattern, iteration);
   }

   static get_greys_map = (all_pixels, all_sets_object, base_value, range_value) => {
      const total_pixels = all_pixels.length;
      // Convert object to sorted array only once
      const all_sets = Object.keys(all_sets_object)
         .map(key => {
            const iteration = parseInt(key.slice(1));
            return {iteration, iteration_count: all_sets_object[key]};
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
   }

   static buffer_to_canvas = (canvas_buffer, ctx, scale_factor = 1) => {
      if (!canvas_buffer || !ctx) {
         console.log('!canvas_buffer || !ctx')
         return;
      }
      const all_not_pattern_pixels = [];
      const all_inner_pattern_pixels = [];
      const all_outer_pattern_pixels = [];
      const all_not_pattern_sets = {};
      const all_inner_pattern_sets = {};
      const all_outer_pattern_sets = {};
      // Use for loops for better performance
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
               all_not_pattern_pixels.push({iteration: point_data[1], canvas_x, canvas_y});
            } else {
               if (point_data[0] < 0) {
                  all_inner_pattern_sets[key] = (all_inner_pattern_sets[key] || 0) + 1;
                  all_inner_pattern_pixels.push({
                     pattern: Math.abs(point_data[0]),
                     iteration: Math.abs(point_data[1]),
                     canvas_x, canvas_y
                  });
               } else {
                  all_outer_pattern_sets[key] = (all_outer_pattern_sets[key] || 0) + 1;
                  all_outer_pattern_pixels.push({
                     pattern: Math.abs(point_data[0]),
                     iteration: Math.abs(point_data[1]),
                     canvas_x, canvas_y
                  });
               }
            }
         }
      }

      const not_pattern_greys_map = FractoColors.get_greys_map(
         all_not_pattern_pixels, all_not_pattern_sets, GREY_BASE, GREY_RANGE);
      const inner_pattern_greys_map = FractoColors.get_greys_map(
         all_inner_pattern_pixels, all_inner_pattern_sets, COLOR_LUM_BASE_PCT, COLOR_LUM_BASE_RANGE_PCT);
      const outer_pattern_greys_map = FractoColors.get_greys_map(
         all_outer_pattern_pixels, all_outer_pattern_sets, COLOR_LUM_BASE_PCT, COLOR_LUM_BASE_RANGE_PCT);

      const pixel_size = 1.5 * scale_factor;
      // Use for loop for better performance
      for (let i = 0; i < all_not_pattern_pixels.length; i++) {
         const pixel = all_not_pattern_pixels[i];
         const key = `_${pixel.iteration}`;
         const grey_value = not_pattern_greys_map[key];
         ctx.fillStyle = `rgb(${grey_value},${grey_value},${grey_value})`;
         ctx.fillRect(scale_factor * pixel.canvas_x, scale_factor * pixel.canvas_y, pixel_size, pixel_size);
      }
      for (let i = 0; i < all_inner_pattern_pixels.length; i++) {
         const pixel = all_inner_pattern_pixels[i];
         const key = `_${Math.abs(pixel.iteration)}`;
         const lum_factor = inner_pattern_greys_map[key];
         const hue = FractoColors.pattern_hue(pixel.pattern);
         ctx.fillStyle = `hsl(${hue}, 80%, ${100 - lum_factor}%)`;
         ctx.fillRect(scale_factor * pixel.canvas_x, scale_factor * pixel.canvas_y, pixel_size, pixel_size);
      }
      for (let i = 0; i < all_outer_pattern_pixels.length; i++) {
         const pixel = all_outer_pattern_pixels[i];
         const key = `_${Math.abs(pixel.iteration)}`;
         const lum_factor = outer_pattern_greys_map[key];
         const hue = FractoColors.pattern_hue(pixel.pattern);
         ctx.fillStyle = `hsl(${hue}, 80%, ${100 - lum_factor}%)`;
         ctx.fillRect(scale_factor * pixel.canvas_x, scale_factor * pixel.canvas_y, pixel_size, pixel_size);
      }
   }

}

export default FractoColors;