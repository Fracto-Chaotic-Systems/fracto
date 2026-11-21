// Generated once per rig: deterministic aged ABS, with separate pigment,
// surface-grain and roughness maps. No texture downloads or per-frame painting.
export function createAgedPlastic(
  THREE,
  { canvasFactory = () => document.createElement("canvas") } = {},
) {
  const size = 512;
  const canvas = () => {
    const result = canvasFactory();
    result.width = result.height = size;
    return result;
  };
  const color = canvas(),
    bump = canvas(),
    roughness = canvas();
  const ctx = color.getContext("2d");
  const pigment = ctx.createImageData(size, size);
  const relief = bump.getContext("2d").createImageData(size, size);
  const finish = roughness.getContext("2d").createImageData(size, size);
  const hash = (x, y) => {
    let n = Math.imul(x + 91, 374761393) ^ Math.imul(y + 17, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const noise = (x, y) => {
    const ix = Math.floor(x),
      iy = Math.floor(y);
    let fx = x - ix,
      fy = y - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), fx),
      THREE.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), fx),
      fy,
    );
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      const u = x / size,
        v = y / size;
      const age = noise(u * 5, v * 5);
      const mottling = noise(u * 22, v * 22);
      const grain = hash(x + 1000, y + 1000);
      const edge = Math.exp(-Math.min(u, v, 1 - u, 1 - v) * 48);
      const dirt = Math.max(0, mottling - 0.58) * 42 + edge * 30;
      const speck = grain < 0.012 ? 32 : 0;
      const shade = (grain - 0.5) * 16 - dirt - speck;
      pigment.data.set(
        [
          167 + age * 24 + shade,
          158 + age * 15 + shade,
          132 + age * 4 + shade,
          255,
        ],
        index,
      );
      const height = 120 + grain * 40 - speck;
      relief.data.set([height, height, height, 255], index);
      const matte = 205 + mottling * 40 + grain * 9;
      finish.data.set([matte, matte, matte, 255], index);
    }
  ctx.putImageData(pigment, 0, 0);
  bump.getContext("2d").putImageData(relief, 0, 0);
  roughness.getContext("2d").putImageData(finish, 0, 0);
  // Small rubbed marks and accumulated grime remain visible at gameplay scale.
  for (let i = 0; i < 95; i++) {
    const x = hash(i, 8) * size,
      y = hash(i, 13) * size;
    const length = 3 + hash(i, 23) * 25;
    ctx.strokeStyle = i % 3 ? "rgba(57,49,32,0.22)" : "rgba(240,231,200,0.4)";
    ctx.lineWidth = 0.4 + hash(i, 31) * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + length, y + hash(i, 44) * 5 - 2.5);
    ctx.stroke();
  }
  const map = new THREE.CanvasTexture(color);
  map.colorSpace = THREE.SRGBColorSpace;
  const bumpMap = new THREE.CanvasTexture(bump);
  const roughnessMap = new THREE.CanvasTexture(roughness);
  const properties = {
    map,
    bumpMap,
    roughnessMap,
    metalness: 0,
    roughness: 1,
    bumpScale: 0.008,
  };
  return {
    shell: new THREE.MeshStandardMaterial({ ...properties, color: "#ffffff" }),
    bezel: new THREE.MeshStandardMaterial({
      ...properties,
      color: "#50534c",
      bumpScale: 0.004,
    }),
  };
}
