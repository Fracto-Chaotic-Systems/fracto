import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createMechanicalTools } from "../assets/three-mechanics.mjs";
import { createAgedPlastic } from "../assets/aged-plastic.mjs";
import { createWeatheredMetal } from "../assets/weathered-metal.mjs";
const flag = process.argv.indexOf("--project-root");
if (flag < 0 || !process.argv[flag + 1])
  throw new Error(
    "Usage: node verify-mechanics.mjs --project-root <project-with-three-installed>",
  );
const require = createRequire(resolve(process.argv[flag + 1], "package.json"));
const resolvedEntry = require.resolve("three");
const esmEntry = resolve(dirname(resolvedEntry), "three.module.js");
const threeModule = await import(
  pathToFileURL(existsSync(esmEntry) ? esmEntry : resolvedEntry).href
);
const THREE = threeModule.Vector3 ? threeModule : threeModule.default;
const { solveTwoBone, connectLink, createCableTube, updateCableTube } =
  createMechanicalTools(THREE);
const root = new THREE.Vector3(0.2, 1.7, -0.4);
for (const target of [
  root.clone(),
  new THREE.Vector3(0.3, 0.8, 0.5),
  new THREE.Vector3(0.2, 1.7, -1.5),
  new THREE.Vector3(20, 0, 0),
]) {
  for (const lengths of [
    [1.3, 1.3],
    [1.5, 0.7],
  ]) {
    const result = solveTwoBone(root, target, {
      upperLength: lengths[0],
      lowerLength: lengths[1],
      bendDirection: target.clone().sub(root),
    });
    assert.ok(Math.abs(result.elbow.distanceTo(root) - lengths[0]) < 1e-8);
    assert.ok(
      Math.abs(result.elbow.distanceTo(result.wrist) - lengths[1]) < 1e-8,
    );
    assert.ok(
      [result.elbow, result.wrist].every((p) =>
        p.toArray().every(Number.isFinite),
      ),
    );
    if (result.reachable) assert.ok(result.wrist.distanceTo(target) < 1e-8);
  }
}
const link = new THREE.Object3D();
assert.equal(connectLink(link, root, root), false);
assert.ok(link.quaternion.toArray().every(Number.isFinite));
const cable = createCableTube();
const buffer = cable.geometry.getAttribute("position");
for (const offset of [0, 0.4, -0.3]) {
  const start = new THREE.Vector3(0, 2, 0),
    end = new THREE.Vector3(0.8 + offset, 0.8, 0.2);
  const curve = new THREE.CatmullRomCurve3([
    start,
    new THREE.Vector3(-0.3, -0.5, 0),
    new THREE.Vector3(0.8, -0.5, 0.3),
    end,
  ]);
  updateCableTube(cable, curve);
  assert.equal(cable.geometry.getAttribute("position"), buffer);
  assert.ok([...buffer.array].every(Number.isFinite));
  const normals = cable.geometry.getAttribute("normal");
  assert.ok([...normals.array].every(Number.isFinite));
  for (let ring of [0, 48]) {
    const center = new THREE.Vector3();
    for (let side = 0; side < 8; side++)
      center.add(
        new THREE.Vector3().fromBufferAttribute(buffer, ring * 9 + side),
      );
    center.divideScalar(8);
    assert.ok(center.distanceTo(ring ? end : start) < 1e-6);
  }
  const indices = cable.geometry.index.array;
  for (let face = 0; face < indices.length; face += 6) {
    const a = new THREE.Vector3().fromBufferAttribute(buffer, indices[face]);
    const b = new THREE.Vector3().fromBufferAttribute(
      buffer,
      indices[face + 1],
    );
    const c = new THREE.Vector3().fromBufferAttribute(
      buffer,
      indices[face + 2],
    );
    const n = new THREE.Vector3().fromBufferAttribute(normals, indices[face]);
    assert.ok(
      b.sub(a).cross(c.sub(a)).dot(n) > 0,
      "Cable triangle must face outward",
    );
  }
}
cable.geometry.dispose();
cable.material.dispose();
// Exercise material factories without a browser or a native canvas dependency.
// Browser rendering still needs separate visual verification in the target app.
const canvasFactory = () => ({
  width: 0,
  height: 0,
  getContext() {
    return {
      createImageData: (width, height) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
    };
  },
});
for (const materials of [
  createAgedPlastic(THREE, { canvasFactory }),
  createWeatheredMetal(THREE, { canvasFactory, seed: 17 }),
]) {
  const values = Object.values(materials),
    textures = new Set();
  for (const material of values) {
    assert.ok(material.isMeshStandardMaterial);
    assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
    assert.ok(material.bumpMap.isTexture && material.roughnessMap.isTexture);
    assert.equal(material.map, values[0].map);
    for (const value of Object.values(material))
      if (value?.isTexture) textures.add(value);
    material.dispose();
  }
  textures.forEach((texture) => texture.dispose());
}
console.log(
  "Verified arm reach/lengths, cable endpoints/buffer reuse/winding, finite geometry and portable material factories.",
);
