import { tuned_doubling_angles } from "./FractoParameterTuning.js";
import { distance, finite } from "./FractoRayGeometry.js";
import { doubling_attachment } from "./FractoParameterAttachment.js";
import { attachment_angles } from "./FractoParameterAngles.js";
import { trace_parameter_ray } from "./FractoParameterRayTrace.js";
export { trace_parameter_ray } from "./FractoParameterRayTrace.js";
export const trace_depth_for_period = (period, local_period = 2) =>
  Math.max(4096, 256 * period * local_period);

/** Each ray retains its own accepted prefix; a failed partner cannot erase it. */
export function trace_parameter_ray_group(
  angles,
  root,
  tolerance,
  options = {},
) {
  const rays = [],
    failures = [];
  for (const angle of angles) {
    try {
      rays.push(
        trace_parameter_ray(angle, root, tolerance, {
          allow_partial: true,
          ...options,
        }),
      );
    } catch (error) {
      failures.push({ angle, status: error.message, details: error.details });
    }
  }
  const status =
    rays.length > 0 &&
    rays.length === angles.length &&
    rays.every((ray) => ray.landed)
      ? "complete"
      : rays.length
        ? "incomplete"
        : failures[0]?.status || "unresolved";
  return { status, rays, failures };
}

/** Parameter-plane period-doubling wake; see PARAMETER_RAYS.md. */
export function find_doubling_rays(
  core,
  period,
  { tolerance = 1e-3, on_progress = () => {}, root_angles } = {},
) {
  try {
    if (
      !Number.isFinite(tolerance) ||
      !finite(core) ||
      !Number.isInteger(period) ||
      period < 1 ||
      period > 20 ||
      !(tolerance >= 1e-12)
    )
      return { status: "unsupported", rays: [] };
    on_progress("attachment");
    const attachment = doubling_attachment(core, period);
    if (
      distance(core, attachment.center) >
      Math.max(1e-5, 2 * distance(attachment.center, attachment.root))
    )
      throw Error("core_unresolved");
    on_progress("angles");
    const angles = root_angles
      ? tuned_doubling_angles(root_angles, period)
      : attachment_angles(attachment, period);
    for (const angle of angles) {
      let a = BigInt(angle.numerator),
        d = BigInt(angle.denominator);
      for (let k = 1; k <= 2 * period; k++) {
        a = (a * 2n) % d;
        if (a === BigInt(angle.numerator) && k < 2 * period)
          throw Error("angles_unresolved");
      }
    }
    on_progress("tracing");
    const traced = trace_parameter_ray_group(
      angles,
      attachment.root,
      tolerance,
      {
        max_depth: trace_depth_for_period(period),
      },
    );
    return {
      ...traced,
      root: attachment.root,
      period: 2 * period,
      angle_source: root_angles ? "root_tuning" : "gradient_probes",
    };
  } catch (error) {
    return { status: error.message, rays: [], details: error.details };
  }
}
