/** Complex arithmetic and exact angle transport for dynamic rays.
 * Basis: Milnor, Astérisque 261 (2000), §2 and Appendix A.
 * https://numdam.org/item/AST_2000__261__277_0/
 */
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a, b) => ({
  x: a.x * b.x - a.y * b.y,
  y: a.x * b.y + a.y * b.x,
});
export const scale = (a, k) => ({ x: a.x * k, y: a.y * k });
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const finite = (p) => Number.isFinite(p?.x) && Number.isFinite(p?.y);
export const sqrt = (z) => {
  const r = Math.hypot(z.x, z.y);
  if (r === 0) return { x: 0, y: 0 };
  if (z.x >= 0) {
    const x = Math.sqrt((r + z.x) / 2);
    return { x, y: z.y / (2 * x) };
  }
  const y = (z.y < 0 ? -1 : 1) * Math.sqrt((r - z.x) / 2);
  return { x: Math.abs(z.y) / (2 * Math.abs(y)), y };
};
const gcd = (a, b) => (b === 0n ? a : gcd(b, a % b));
export const rational_angle = (numerator, denominator) => {
  let d = BigInt(denominator);
  if (d <= 0n) throw new RangeError("Positive denominator required");
  let n = ((BigInt(numerator) % d) + d) % d;
  const g = gcd(n, d);
  n /= g;
  d /= g;
  return {
    numerator: String(n),
    denominator: String(d),
    value: Number(n) / Number(d),
    key: `${n}/${d}`,
  };
};
export const doubled_angle = (angle, levels = 1) =>
  rational_angle(
    BigInt(angle.numerator) * (1n << BigInt(levels)),
    angle.denominator,
  );
export const angle_at = (angle, level) =>
  doubled_angle(angle, level).value * 2 * Math.PI;
export const primitive_period = (points) => {
  for (let p = 1; p <= points.length; p++)
    if (
      points.length % p === 0 &&
      points.every((z, i) => distance(z, points[i % p]) < 1e-10)
    )
      return p;
  return points.length;
};
