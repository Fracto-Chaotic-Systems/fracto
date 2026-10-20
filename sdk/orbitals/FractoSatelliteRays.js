import { component_attachment } from "./FractoParameterAttachment.js";
import { tuned_wake_angles } from "./FractoParameterTuning.js";
import { distance, finite } from "./FractoRayGeometry.js";
import {
  trace_parameter_ray_group,
  trace_depth_for_period,
} from "./FractoParameterRays.js";

const WAKES = {
  "1/3": { numerator: 1, words: ["001", "010"] },
  "2/3": { numerator: 2, words: ["101", "110"] },
};
/** Tuned local period-three wakes. Published basis and contracts: SATELLITE_RAYS.md. */
export function find_satellite_wake_rays(
  core,
  period,
  rotation,
  { root_angles, tolerance = 1e-3, on_progress = () => {} } = {},
) {
  try {
    const wake = WAKES[rotation];
    if (
      !wake ||
      !finite(core) ||
      !Number.isInteger(period) ||
      period < 1 ||
      period > 20 ||
      !Number.isFinite(tolerance) ||
      tolerance < 1e-12
    )
      return { rotation, status: "unsupported", rays: [] };
    if (!root_angles)
      return { rotation, status: "root_angles_required", rays: [] };
    on_progress("third_attachment");
    const theta = (2 * Math.PI * wake.numerator) / 3;
    const attachment = component_attachment(core, period, {
      x: Math.cos(theta),
      y: Math.sin(theta),
    });
    if (
      distance(core, attachment.center) >
      Math.max(1e-5, 2 * distance(attachment.center, attachment.root))
    )
      throw Error("core_unresolved");
    on_progress("third_angles");
    const angles = tuned_wake_angles(root_angles, period, wake.words),
      child_period = 3 * period;
    for (const angle of angles) {
      let a = BigInt(angle.numerator),
        d = BigInt(angle.denominator);
      for (let k = 1; k <= child_period; k++) {
        a = (a * 2n) % d;
        if (a === BigInt(angle.numerator) && k < child_period)
          throw Error("angles_unresolved");
      }
    }
    on_progress("third_tracing");
    const traced = trace_parameter_ray_group(
      angles,
      attachment.root,
      tolerance,
      { max_depth: trace_depth_for_period(period, 3) },
    );
    return {
      ...traced,
      rotation,
      root: attachment.root,
      period: child_period,
      angle_source: "root_tuning",
    };
  } catch (error) {
    return {
      rotation,
      status: error.message,
      rays: [],
      details: error.details,
    };
  }
}
