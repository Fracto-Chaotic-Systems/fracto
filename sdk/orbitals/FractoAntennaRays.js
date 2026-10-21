import { big_refine_antenna_tip } from "./FractoParameterBigTip.js";
import {
  MAX_PARAMETER_PERIOD,
  finite_parameter,
} from "./FractoParameterPrecision.js";
/** Principal tuned antenna tip; published theory and limits: ANTENNA_RAYS.md. */
import { tuned_tip_angles } from "./FractoParameterTuning.js";
import { critical } from "./FractoParameterAttachment.js";
import {
  trace_parameter_ray,
  trace_parameter_ray_group,
  trace_depth_for_period,
} from "./FractoParameterRays.js";
import {
  sub,
  mul,
  scale,
  finite,
  distance,
  divide,
} from "./FractoRayGeometry.js";
const ZERO = { x: 0, y: 0 };

/** A tuned -2 satisfies f^(3P)(0)=f^(2P)(0), with a repelling return. */
export function refine_antenna_tip(guess, period) {
  if (
    !finite(guess) ||
    !Number.isInteger(period) ||
    period < 1 ||
    period > MAX_PARAMETER_PERIOD
  )
    throw Error("tip_unresolved");
  if (period > 20 || guess.exact) return big_refine_antenna_tip(guess, period);
  let c = { ...guess };
  for (let k = 0; k < 40; k++) {
    const a = critical(c, 2 * period),
      b = critical(c, 3 * period);
    const step = divide(sub(b.z, a.z), sub(b.d, a.d));
    if (!finite(step)) throw Error("tip_unresolved");
    c = sub(c, step);
    if (!finite(c)) throw Error("tip_unresolved");
    if (distance(step, ZERO) < 1e-14) break;
  }
  const a = critical(c, 2 * period),
    b = critical(c, 3 * period);
  let z = a.z,
    multiplier = { x: 1, y: 0 };
  for (let k = 0; k < period; k++) {
    multiplier = scale(mul(z, multiplier), 2);
    z = { x: z.x * z.x - z.y * z.y + c.x, y: 2 * z.x * z.y + c.y };
  }
  if (
    !finite(b.z) ||
    !finite(multiplier) ||
    distance(a.z, b.z) > 1e-8 ||
    distance(multiplier, ZERO) <= 1 + 1e-6 ||
    distance(critical(c, period).z, a.z) < 1e-8
  )
    throw Error("tip_unresolved");
  return c;
}

export function find_antenna_tip_rays(
  core,
  period,
  { root_angles, tolerance = 1e-3, on_progress = () => {} } = {},
) {
  try {
    if (
      !finite_parameter(core) ||
      !Number.isInteger(period) ||
      period < 1 ||
      period > MAX_PARAMETER_PERIOD ||
      !Number.isFinite(tolerance) ||
      tolerance < 1e-12
    )
      return { status: "unsupported", rays: [] };
    if (!root_angles) return { status: "root_angles_required", rays: [] };
    on_progress("tip_angles");
    const angles = tuned_tip_angles(root_angles, period);
    on_progress("tip_locating");
    // Ray continuation selects the correct preperiodic root; no geometric
    // extrapolation from the center or bulb attachment is assumed.
    const probe = trace_parameter_ray(angles[0], core, 1e-12, {
      max_depth: Math.max(256, 64 * period),
      allow_partial: true,
    });
    const guess = probe.points.at(-1);
    let tip;
    try {
      tip = refine_antenna_tip(guess, period);
      if (
        distance(tip, guess) >
        Math.max(tolerance * 4, distance(guess, core) * 0.05)
      )
        throw Error("tip_unresolved");
    } catch {
      const partial = trace_parameter_ray_group(angles, core, 1e-12, {
        max_depth: Math.max(256, 64 * period),
      });
      return {
        ...partial,
        status: "incomplete",
        endpoint_status: "tip_unresolved",
        rays: partial.rays.map((ray) => ({
          ...ray,
          landed: false,
          status: "incomplete",
        })),
      };
    }
    on_progress("tip_tracing");
    const traced = trace_parameter_ray_group(angles, tip, tolerance, {
      max_depth: trace_depth_for_period(period),
    });
    return {
      ...traced,
      root: tip,
      angle_source: "root_tuning",
      endpoint_kind: "misiurewicz",
    };
  } catch (error) {
    return { status: error.message, rays: [], details: error.details };
  }
}
