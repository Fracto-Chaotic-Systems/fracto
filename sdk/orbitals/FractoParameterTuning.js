import { MAX_PARAMETER_PERIOD } from "./FractoParameterPrecision.js";
import { rational_angle } from "./FractoRayGeometry.js";

/** Exact binary-block substitution for local bulb wakes. Milnor (2000), section 8;
 * see PARAMETER_RAYS.md. Inputs must be the selected component's verified pair.
 */
function parent_blocks(root_angles, period) {
  if (
    !Number.isInteger(period) ||
    period < 1 ||
    period > MAX_PARAMETER_PERIOD ||
    !Array.isArray(root_angles)
  )
    throw Error("angles_unresolved");
  const base = 1n << BigInt(period),
    D = base - 1n;
  let blocks;
  if (period === 1) {
    if (
      root_angles.length !== 1 ||
      rational_angle(root_angles[0].numerator, root_angles[0].denominator)
        .key !== "0/1"
    )
      throw Error("angles_unresolved");
    blocks = [0n, 1n];
  } else {
    if (root_angles.length !== 2) throw Error("angles_unresolved");
    blocks = root_angles
      .map((a) => {
        const normalized = rational_angle(a.numerator, a.denominator),
          n = BigInt(normalized.numerator),
          d = BigInt(normalized.denominator);
        if (D % d !== 0n) throw Error("angles_unresolved");
        let m = n;
        for (let k = 1; k <= period; k++) {
          m = (m * 2n) % d;
          if (m === n && k < period) throw Error("angles_unresolved");
        }
        return n * (D / d);
      })
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (blocks[0] === blocks[1]) throw Error("angles_unresolved");
  }
  return { base, blocks };
}

/** Substitute parent binary blocks for each local external-angle word. */
export function tuned_wake_angles(root_angles, period, words) {
  if (
    !Array.isArray(words) ||
    words.length !== 2 ||
    !words.every(
      (word) =>
        typeof word === "string" &&
        /^[01]+$/.test(word) &&
        word.length === words[0].length &&
        word.length <= Math.max(16, Math.floor(MAX_PARAMETER_PERIOD / period)),
    )
  )
    throw Error("angles_unresolved");
  const { base, blocks } = parent_blocks(root_angles, period);
  const denominator = base ** BigInt(words[0].length) - 1n;
  return words.map((word) => {
    let numerator = 0n;
    for (const bit of word) numerator = numerator * base + blocks[Number(bit)];
    return rational_angle(numerator, denominator);
  });
}

export const tuned_doubling_angles = (root_angles, period) =>
  tuned_wake_angles(root_angles, period, ["01", "10"]);

/** Two binary expansions of local external angle 1/2: B(A), A(B). */
export function tuned_tip_angles(root_angles, period) {
  const {
    base,
    blocks: [a, b],
  } = parent_blocks(root_angles, period);
  const denominator = base * (base - 1n);
  const angles = [
    rational_angle(b * (base - 1n) + a, denominator),
    rational_angle(a * (base - 1n) + b, denominator),
  ];
  return [...new Map(angles.map((angle) => [angle.key, angle])).values()];
}
