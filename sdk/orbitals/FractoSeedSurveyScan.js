export const SEED_SURVEY_DISCOVERY_OPTIONS = Object.freeze({
  grid_size: 250,
  half_span: 1.5,
  sampling: "bounds",
  iteration_limit: 100000,
  newton_iterations: 80,
  precision_digits: 64,
});
import FractoFastCalc from "../FractoFastCalc.js";
import { newton_big_complex } from "./FractoNewtonBigComplex.js";
import {
  orbital_confirmation,
  orbital_closure_error,
  ORBIT_CLOSURE_TOLERANCE,
} from "./FractoSeedSurveyConfirmation.js";

export const MAX_SCAN_ORBITALS = 100;
const POINT_TOLERANCE = 1e-7;

/** Visit every positive-pattern grid cell once, including interiors and edges. */
export function* non_escape_seeds({ canvas_buffer, half_span, sampling }) {
  const size = canvas_buffer.length;
  const coordinate = (index) =>
    size === 1
      ? 0
      : sampling === "centers"
        ? -half_span + ((index + 0.5) * 2 * half_span) / size
        : -half_span + (index * 2 * half_span) / (size - 1);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      if (canvas_buffer[column][row]?.[0] > 0) {
        yield {
          seed: { x: coordinate(column), y: -coordinate(row) || 0 },
          row,
          column,
        };
      }
    }
  }
}

/** A candidate matches when its first point is near any known orbital point. */
export const same_orbital = (candidate, existing) => {
  const point = candidate[0];
  return Boolean(
    point &&
    existing.some(
      (other) => Math.hypot(point.x - other.x, point.y - other.y) <= 0.01,
    ),
  );
};

/** Merge geometric matches regardless of confidence; preserve stable group identity. */
export const merge_orbital = (found, orbital, id) => {
  let merged = {
    ...orbital,
    orbital_id: id,
    merged_ids: [],
    discovery_count: 1,
  };
  let index = 0;
  while (index < found.length) {
    const existing = found[index];
    // Compare in both directions so matching does not depend on discovery order.
    if (
      !same_orbital(merged.points, existing.points) &&
      !same_orbital(existing.points, merged.points)
    ) {
      index++;
      continue;
    }
    const best = merged.confidence > existing.confidence ? merged : existing;
    merged = {
      ...best,
      orbital_id: existing.orbital_id,
      merged_ids: [
        ...new Set([
          ...(existing.merged_ids || []),
          ...(merged.merged_ids || []),
          merged.orbital_id,
        ]),
      ].filter((value) => value !== existing.orbital_id),
      discovery_count: existing.discovery_count + merged.discovery_count,
    };
    found.splice(index, 1);
    // The best point set may now overlap an earlier configuration as well.
    index = 0;
  }
  found.push(merged);
};

export const refine_seed = (survey, seed) => {
  const c = survey.focal_point;
  const calculation = FractoFastCalc.calc_from_seed(
    c.x,
    c.y,
    seed.x,
    seed.y,
    0.00625,
    survey.iteration_limit,
  );
  if (!Number.isInteger(calculation?.pattern) || calculation.pattern < 1)
    return null;
  const newton = newton_big_complex(
    c,
    survey.newton_iterations ?? SEED_SURVEY_DISCOVERY_OPTIONS.newton_iterations,
    calculation.pattern,
    {
      precision_digits:
        survey.precision_digits ??
        SEED_SURVEY_DISCOVERY_OPTIONS.precision_digits,
      seed,
    },
  );
  if (newton.closure_reached !== true) return null;
  const points = (newton.point_list || []).map(({ re, im }) => ({
    x: Number(re),
    y: Number(im),
  }));
  if (
    points.length !== calculation.pattern ||
    !points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  )
    return null;
  const closure_error = orbital_closure_error(points, c);
  if (closure_error === null || closure_error > ORBIT_CLOSURE_TOLERANCE)
    return null;
  const Q = FractoFastCalc.calculate_cardioid_Q(c.x, c.y, -1);
  const magnitude = Math.max(
    ...points.map((p) => Math.hypot(p.x - Q.x, p.y - Q.y)),
  );
  const confirmation = orbital_confirmation(points, magnitude);
  if (!confirmation) return null;
  // Reduce repeated traversals before comparing discoveries of the same cycle.
  const repeat = points.findIndex(
    (p, index) =>
      index > 0 &&
      Math.hypot(p.x - points[0].x, p.y - points[0].y) <= POINT_TOLERANCE,
  );
  const unique_points =
    repeat > 0 &&
    points.length % repeat === 0 &&
    points.every(
      (p, i) =>
        Math.hypot(p.x - points[i % repeat].x, p.y - points[i % repeat].y) <=
        POINT_TOLERANCE,
    )
      ? points.slice(0, repeat)
      : points;
  const reduced_closure_error = orbital_closure_error(unique_points, c);
  if (
    reduced_closure_error === null ||
    reduced_closure_error > ORBIT_CLOSURE_TOLERANCE
  )
    return null;
  return {
    seed,
    points: unique_points,
    precise_points: newton.point_list
      .slice(0, unique_points.length)
      .map((p) => ({ re: String(p.re), im: String(p.im) })),
    magnitude,
    confidence: confirmation.confidence,
    cycles: newton.cycles,
    closure_error: reduced_closure_error,
  };
};

/** Yield between seed samples so hover and navigation remain responsive. */
export const scan_orbitals = async (
  survey,
  {
    cancelled = () => false,
    on_result = () => {},
    on_progress = () => {},
    refine = refine_seed,
    pause = () => new Promise((resolve) => setTimeout(resolve, 0)),
    state = { found: [], tested_pixels: new Set() },
  } = {},
) => {
  const { found, tested_pixels } = state;
  const total =
    survey.cached_seeds ?? Array.from(non_escape_seeds(survey)).length;
  const report_progress = () =>
    on_progress({ processed: tested_pixels.size, total });
  report_progress();
  const ranked = () =>
    [...found]
      .sort(
        (a, b) =>
          b.discovery_count - a.discovery_count || a.orbital_id - b.orbital_id,
      )
      .slice(0, MAX_SCAN_ORBITALS);
  for (const { seed, row, column } of non_escape_seeds(survey)) {
    const pixel = row * survey.canvas_buffer.length + column;
    if (tested_pixels.has(pixel)) continue;
    await pause();
    if (cancelled()) return ranked();
    tested_pixels.add(pixel);
    const orbital = refine(survey, seed);
    report_progress();
    if (!orbital || !Number.isFinite(orbital.confidence)) continue;
    merge_orbital(found, orbital, pixel);
    on_result(ranked());
  }
  return ranked();
};
