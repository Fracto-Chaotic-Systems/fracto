import { component_attachment } from "./FractoParameterAttachment.js";
import { attachment_angles } from "./FractoParameterAngles.js";
import { satellite_parent, rotation_words } from "./FractoParameterParent.js";
import { tuned_wake_angles } from "./FractoParameterTuning.js";
import { rational_angle } from "./FractoRayGeometry.js";

/** Resolve ancestry without retracing every ancestor; final root rays validate it. */
export function component_root_angles(
  attachment,
  period,
  on_progress = () => {},
) {
  if (period === 1) return [rational_angle(0, 1)];
  if (period > 20 || attachment.precision) {
    on_progress("combinatorial_angles");
    const parent = satellite_parent(attachment.root, period);
    if (parent) {
      const parent_attachment = component_attachment(
        parent.core,
        parent.period,
        1,
      );
      const angles = component_root_angles(
        parent_attachment,
        parent.period,
        on_progress,
      );
      return tuned_wake_angles(
        angles,
        parent.period,
        rotation_words(parent.numerator, parent.denominator),
      );
    }
  }
  const options = {
    angle_period: period,
    cusp: attachment.cusp,
    probe_scale: attachment.cusp ? 0.5 : 1,
    shrink: 0.8,
  };
  try {
    return attachment_angles(attachment, period, options);
  } catch (error) {
    if (
      attachment.precision ||
      period > 20 ||
      error.message !== "angles_unresolved"
    )
      throw error;
    // The short, gently shrinking schedule can miss a primitive cusp's
    // characteristic pair. Start farther out and cover more scales before
    // spending a Decimal integration budget. Inward tracing validates the pair.
    return attachment_angles(attachment, period, {
      ...options,
      probe_scale: 1,
      shrink: 0.5,
    });
  }
}
