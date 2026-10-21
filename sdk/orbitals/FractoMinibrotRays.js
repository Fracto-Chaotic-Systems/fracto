import {
  ray_cache_matches,
  reusable_ray_group,
  best_ray_group,
  visible_ray_group,
} from "./FractoMinibrotRayCache.js";
import { component_root_angles } from "./FractoParameterRootAngles.js";
import {
  MAX_PARAMETER_PERIOD,
  finite_parameter,
  parameter_distance,
} from "./FractoParameterPrecision.js";
import { find_antenna_tip_rays } from "./FractoAntennaRays.js";
import { find_satellite_wake_rays } from "./FractoSatelliteRays.js";
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
      !finite_parameter(core) ||
      !Number.isInteger(period) ||
      period < 1 ||
      period > MAX_PARAMETER_PERIOD ||
      !Number.isFinite(tolerance) ||
      tolerance < 1e-12
    )
      return { status: "unsupported", rays: [] };
    on_progress("root_attachment");
    const attachment = component_attachment(core, period, 1);
    if (
      parameter_distance(core, attachment.center) >
      Math.max(1e-5, 2 * parameter_distance(attachment.center, attachment.root))
    )
      throw Error("core_unresolved");
    on_progress("root_angles");
    const angles = component_root_angles(attachment, period, on_progress);
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
  const cache =
    options.cache && ray_cache_matches(options.cache, core, period)
      ? options.cache
      : null;
  const calculate = (id, fn) => {
    const saved = cache?.groups?.[id];
    if (saved && reusable_ray_group(saved, options.tolerance ?? 1e-3))
      return saved.result;
    const fresh = fn();
    options.on_group?.(id, fresh);
    if (
      saved &&
      best_ray_group(saved, {
        result: fresh,
        tolerance: options.tolerance ?? 1e-3,
      }) === saved
    )
      return visible_ray_group(saved, options.tolerance ?? 1e-3);
    return fresh;
  };
  const root = calculate("root_access", () =>
    find_component_root_rays(core, period, options),
  );
  const doubling = calculate("doubling", () =>
    find_doubling_rays(core, period, {
      ...options,
      root_angles:
        root.status === "complete"
          ? root.rays.map((ray) => ray.angle)
          : undefined,
    }),
  );
  const third_results = options.include_thirds
    ? ["1/3", "2/3"].map((rotation) =>
        calculate(rotation, () =>
          find_satellite_wake_rays(core, period, rotation, {
            ...options,
            root_angles:
              root.status === "complete"
                ? root.rays.map((ray) => ray.angle)
                : undefined,
          }),
        ),
      )
    : [];
  const antenna_tip = options.include_tip
    ? calculate("antenna_tip", () =>
        find_antenna_tip_rays(core, period, {
          ...options,
          root_angles:
            root.status === "complete"
              ? root.rays.map((ray) => ray.angle)
              : undefined,
        }),
      )
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
