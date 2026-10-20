import { find_antenna_tip_rays } from "./FractoAntennaRays.js";
import { find_satellite_wake_rays } from "./FractoSatelliteRays.js";
import { attachment_angles } from "./FractoParameterAngles.js";
import { distance, finite } from "./FractoRayGeometry.js";
import { component_attachment } from "./FractoParameterAttachment.js";
import {
  find_doubling_rays,
  trace_parameter_ray_group,
  trace_depth_for_period,
} from "./FractoParameterRays.js";
/** Local period-one access of a selected component, in global external angles. */
export function find_component_root_rays(
  core,
  period,
  { tolerance = 1e-3, on_progress = () => {} } = {},
) {
  try {
    if (
      !finite(core) ||
      !Number.isInteger(period) ||
      period < 1 ||
      period > 20 ||
      !Number.isFinite(tolerance) ||
      tolerance < 1e-12
    )
      return { status: "unsupported", rays: [] };
    on_progress("root_attachment");
    const attachment = component_attachment(core, period, 1);
    if (
      distance(core, attachment.center) >
      Math.max(1e-5, 2 * distance(attachment.center, attachment.root))
    )
      throw Error("core_unresolved");
    on_progress("root_angles");
    const angles =
      period === 1
        ? [{ numerator: "0", denominator: "1", value: 0, key: "0/1" }]
        : attachment_angles(attachment, period, {
            angle_period: period,
            cusp: attachment.cusp,
            probe_scale: attachment.cusp ? 0.5 : 1,
            // Keep confirmation inside narrow usable exterior bands at cusps.
            shrink: 0.8,
          });
    for (const angle of angles) {
      let a = BigInt(angle.numerator),
        d = BigInt(angle.denominator);
      for (let k = 1; k <= period; k++) {
        a = (a * 2n) % d;
        if (a === BigInt(angle.numerator) && k < period)
          throw Error("angles_unresolved");
      }
    }
    on_progress("root_tracing");
    const traced = trace_parameter_ray_group(
      angles,
      attachment.root,
      tolerance,
      {
        max_depth: trace_depth_for_period(period),
      },
    );
    return { ...traced, root: attachment.root, period };
  } catch (error) {
    return { status: error.message, rays: [], details: error.details };
  }
}

/** Preserve complete rays and accepted partial paths from every requested access. */
export function find_minibrot_rays(core, period, options = {}) {
  const root = find_component_root_rays(core, period, options);
  const doubling = find_doubling_rays(core, period, {
    ...options,
    root_angles:
      root.status === "complete"
        ? root.rays.map((ray) => ray.angle)
        : undefined,
  });
  const third_results = options.include_thirds
    ? ["1/3", "2/3"].map((rotation) =>
        find_satellite_wake_rays(core, period, rotation, {
          ...options,
          root_angles:
            root.status === "complete"
              ? root.rays.map((ray) => ray.angle)
              : undefined,
        }),
      )
    : [];
  const antenna_tip = options.include_tip
    ? find_antenna_tip_rays(core, period, {
        ...options,
        root_angles:
          root.status === "complete"
            ? root.rays.map((ray) => ray.angle)
            : undefined,
      })
    : undefined;
  const groups = [
    doubling,
    root,
    ...third_results,
    ...(antenna_tip ? [antenna_tip] : []),
  ];
  const rays = groups.flatMap((group) => group.rays);
  const status = groups.every((group) => group.status === "complete")
    ? "complete"
    : rays.length
      ? "partial"
      : doubling.status;
  return {
    status,
    rays,
    root_access: root,
    ...(antenna_tip ? { antenna_tip } : {}),
    doubling,
    thirds: Object.fromEntries(
      third_results.map((group) => [group.rotation, group]),
    ),
  };
}
