/** Inward continuation and incomplete-prefix policy; see PARAMETER_RAYS.md. */
import {
  parameter_reference,
  perturbed_critical,
  decimal_parameter_sample,
} from "./FractoParameterRaySolver.js";
import {
  add,
  sub,
  distance,
  finite,
  divide as div,
} from "./FractoRayGeometry.js";
const ZERO = { x: 0, y: 0 };
export function trace_parameter_ray(
  angle,
  root,
  tolerance,
  {
    max_depth = 4096,
    sharpness = 4,
    allow_partial = false,
    partial_radius = Infinity,
    time_budget_ms = root.precision ||
    typeof root.x === "string" ||
    typeof root.y === "string"
      ? 120000
      : Infinity,
  } = {},
) {
  if (typeof root.x === "string" || typeof root.y === "string") {
    root = {
      ...root,
      exact: root.exact || { x: String(root.x), y: String(root.y) },
      x: Number(root.x),
      y: Number(root.y),
      precision: root.precision || 80,
    };
  }
  const deadline = Date.now() + time_budget_ms;
  let c = {
      x: 65536 * Math.cos(2 * Math.PI * angle.value),
      y: 65536 * Math.sin(2 * Math.PI * angle.value),
    },
    numerator = BigInt(angle.numerator),
    denominator = BigInt(angle.denominator);
  const points = [c];
  const reference = parameter_reference(root, max_depth);
  let delta = sub(c, root);
  try {
    for (let depth = 1; depth <= max_depth; depth++) {
      if (Date.now() > deadline) throw Error("trace_budget");
      const phase = (2 * Math.PI * Number(numerator)) / Number(denominator);
      for (let j = 0; j < sharpness; j++) {
        const radius = 65536 ** (2 ** (-(j + 0.5) / sharpness)),
          target = { x: radius * Math.cos(phase), y: radius * Math.sin(phase) };
        let next = delta,
          ok = false,
          last_residual = Infinity,
          last_step = Infinity;
        for (let k = 0; k < 40; k++) {
          const { z, d } = perturbed_critical(next, depth, reference),
            residual = sub(z, target),
            step = div(residual, d);
          last_residual = distance(residual, ZERO) / radius;
          last_step = distance(step, ZERO);
          if (!finite(step)) break;
          next = sub(next, step);
          if (
            distance(residual, ZERO) < radius * 1e-9 ||
            (distance(step, ZERO) < 2e-15 &&
              distance(residual, ZERO) < radius * 1e-7)
          ) {
            ok = true;
            break;
          }
        }
        if (!ok && reference.root.precision) {
          const precise = decimal_parameter_sample(
            delta,
            depth,
            reference,
            target,
          );
          if (precise) {
            next = precise;
            ok = true;
          }
        }
        if (
          !ok ||
          !finite(next) ||
          distance(next, delta) > Math.max(1, distance(c, ZERO))
        ) {
          const error = Error("trace_unresolved");
          error.details = {
            depth,
            band_step: j,
            last_residual,
            last_step,
            reason: !ok ? "newton" : "jump",
          };
          throw error;
        }
        delta = next;
        c = add(root, delta);
        points.push(c);
        if (depth > 2 && distance(delta, ZERO) < tolerance)
          return {
            angle,
            points,
            endpoint_error: distance(delta, ZERO),
            landed: true,
            status: "complete",
          };
      }
      numerator = (numerator * 2n) % denominator;
    }
    throw Error("trace_budget");
  } catch (error) {
    const endpoint_error = distance(delta, ZERO);
    if (
      allow_partial &&
      ["trace_budget", "trace_unresolved", "trace_reference"].includes(
        error.message,
      ) &&
      points.length > 1 &&
      Number.isFinite(endpoint_error) &&
      endpoint_error <= partial_radius
    )
      return {
        angle,
        points,
        endpoint_error,
        landed: false,
        status: "incomplete",
        stop_reason: error.message,
        details: error.details,
      };
    throw error;
  }
}
