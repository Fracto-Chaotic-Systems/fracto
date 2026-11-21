// Shared, static texture maps keep all metalwork equally worn without adding
// texture downloads or work to the animation loop.
export function createWeatheredMetal(
  THREE,
  { canvasFactory = () => document.createElement("canvas"), seed = 0 } = {},
) {
  const size = 256;
  const make_canvas = () => {
    const canvas = canvasFactory();
    canvas.width = canvas.height = size;
    return canvas;
  };
  const color = make_canvas(),
    bump = make_canvas(),
    roughness = make_canvas(),
    metalness = make_canvas();
  const ctx = color.getContext("2d");
  const maps = [color, bump, roughness, metalness].map((canvas) =>
    canvas.getContext("2d").createImageData(size, size),
  );
  const hash = (x, y) => {
    let n = Math.imul(x + 71 + seed, 374761393) ^ Math.imul(y + 319, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const noise = (x, y) => {
    const ix = Math.floor(x),
      iy = Math.floor(y);
    let u = x - ix,
      v = y - iy;
    u *= u * (3 - 2 * u);
    v *= v * (3 - 2 * v);
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), u),
      THREE.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), u),
      v,
    );
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      const grain = hash(x + 700, y + 700);
      const stain = noise(x / 27, y / 27);
      const chip = noise(x / 5, y / 5);
      const rust = THREE.MathUtils.clamp((stain + chip * 0.3 - 0.65) * 5, 0, 1);
      const metal = 138 + grain * 40 - stain * 35;
      const pit = grain < 0.07 ? 28 : 0;
      maps[0].data.set(
        [
          THREE.MathUtils.lerp(metal, 147 + grain * 30, rust) - pit,
          THREE.MathUtils.lerp(metal, 74 + grain * 20, rust) - pit,
          THREE.MathUtils.lerp(metal, 33 + grain * 14, rust) - pit,
          255,
        ],
        index,
      );
      const height = 112 + grain * 65 + rust * 16 - pit;
      const matte = 180 + rust * 65 + stain * 9;
      const conductive = 225 * (1 - rust);
      maps[1].data.set([height, height, height, 255], index);
      maps[2].data.set([matte, matte, matte, 255], index);
      maps[3].data.set([conductive, conductive, conductive, 255], index);
    }
  [color, bump, roughness, metalness].forEach((canvas, i) =>
    canvas.getContext("2d").putImageData(maps[i], 0, 0),
  );
  for (let i = 0; i < 85; i++) {
    const x = hash(i, 81) * size,
      y = hash(i, 93) * size;
    ctx.lineWidth = 0.5 + hash(i, 109) * 1.2;
    ctx.strokeStyle = i % 4 ? "rgba(210,213,202,0.55)" : "rgba(19,23,20,0.6)";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 2 + hash(i, 121) * 19, y + hash(i, 135) * 8 - 4);
    ctx.stroke();
  }
  const map = new THREE.CanvasTexture(color);
  map.colorSpace = THREE.SRGBColorSpace;
  const properties = {
    map,
    bumpMap: new THREE.CanvasTexture(bump),
    roughnessMap: new THREE.CanvasTexture(roughness),
    metalnessMap: new THREE.CanvasTexture(metalness),
    roughness: 1,
    metalness: 0.8,
    bumpScale: 0.012,
  };
  return {
    dark: new THREE.MeshStandardMaterial({ ...properties, color: "#59635f" }),
    steel: new THREE.MeshStandardMaterial({ ...properties, color: "#c4cecb" }),
    brass: new THREE.MeshStandardMaterial({
      ...properties,
      color: "#cfb078",
      metalness: 0.65,
    }),
  };
}
