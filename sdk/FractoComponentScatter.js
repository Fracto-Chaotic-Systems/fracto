// Frozen footprint-xz-v1: mulberry32, four draws/attempt (x,z,yaw,scale).
export const COMPONENT_SCATTER_ALGORITHM = "footprint-xz-v1";
const fail = () => {
  throw new Error("scatter_cannot_fit");
};
export function generate_component_scatter(rule, construction) {
  if (
    (rule.algorithm ?? COMPONENT_SCATTER_ALGORITHM) !==
      COMPONENT_SCATTER_ALGORITHM ||
    !Number.isInteger(rule.seed) ||
    rule.seed < 0 ||
    rule.seed > 0xffffffff ||
    !Number.isInteger(rule.count) ||
    rule.count < 0 ||
    rule.count > 1000
  )
    fail();
  const rectangle = (b) =>
    Array.isArray(b) &&
    b.length === 4 &&
    b.every(Number.isFinite) &&
    b[0] < b[2] &&
    b[1] < b[3];
  if (
    !rectangle(rule.bounds) ||
    !Array.isArray(rule.exclusions) ||
    rule.exclusions.length > 32 ||
    !rule.exclusions.every(rectangle) ||
    !Array.isArray(rule.scale) ||
    rule.scale.length !== 2 ||
    !rule.scale.every((n) => Number.isFinite(n) && n > 0 && n <= 1000) ||
    rule.scale[0] > rule.scale[1] ||
    !Array.isArray(construction.footprint_m) ||
    construction.footprint_m.length !== 2 ||
    !construction.footprint_m.every((n) => Number.isFinite(n) && n > 0)
  )
    fail();
  let state = rule.seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const output = [],
    b = rule.bounds;
  for (
    let attempt = 0;
    output.length < rule.count && attempt < Math.max(100, rule.count * 50);
    attempt++
  ) {
    const x = b[0] + random() * (b[2] - b[0]),
      z = b[1] + random() * (b[3] - b[1]);
    const yaw = random() * Math.PI * 2,
      scale = rule.scale[0] + random() * (rule.scale[1] - rule.scale[0]);
    const [w, d] = construction.footprint_m;
    const hx =
      ((Math.abs(Math.cos(yaw)) * w + Math.abs(Math.sin(yaw)) * d) * scale) / 2;
    const hz =
      ((Math.abs(Math.sin(yaw)) * w + Math.abs(Math.cos(yaw)) * d) * scale) / 2;
    if (x - hx < b[0] || x + hx > b[2] || z - hz < b[1] || z + hz > b[3])
      continue;
    if (
      rule.exclusions.some(
        (e) =>
          x + hx >= e[0] && x - hx <= e[2] && z + hz >= e[1] && z - hz <= e[3],
      )
    )
      continue;
    output.push({
      position: [x, 0, z],
      rotation: [0, yaw, 0],
      scale: [scale, scale, scale],
    });
  }
  if (output.length !== rule.count) fail();
  return output;
}
