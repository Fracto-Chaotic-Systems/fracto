// Supply the consuming project's Three.js namespace: no global dependencies.
export function createMechanicalTools(THREE) {
  function solveTwoBone(
    root,
    target,
    {
      upperLength = 1,
      lowerLength = 1,
      bendDirection = new THREE.Vector3(0, 0, -1),
    } = {},
  ) {
    if (!(upperLength > 0 && lowerLength > 0))
      throw new RangeError("Link lengths must be positive");
    const direction = target.clone().sub(root);
    const requested = direction.length();
    if (requested < 1e-10) direction.set(0, -1, 0);
    else direction.divideScalar(requested);
    const epsilon = Math.min(upperLength, lowerLength) * 1e-6;
    const distance = THREE.MathUtils.clamp(
      requested,
      Math.abs(upperLength - lowerLength) + epsilon,
      upperLength + lowerLength - epsilon,
    );
    const along =
      (upperLength * upperLength -
        lowerLength * lowerLength +
        distance * distance) /
      (2 * distance);
    const pole = bendDirection
      .clone()
      .addScaledVector(direction, -bendDirection.dot(direction));
    if (pole.lengthSq() < 1e-12) {
      pole.set(
        Math.abs(direction.x) < 0.8 ? 1 : 0,
        Math.abs(direction.x) < 0.8 ? 0 : 1,
        0,
      );
      pole.addScaledVector(direction, -pole.dot(direction));
    }
    pole.normalize();
    return {
      elbow: root
        .clone()
        .addScaledVector(direction, along)
        .addScaledVector(
          pole,
          Math.sqrt(Math.max(0, upperLength * upperLength - along * along)),
        ),
      wrist: root.clone().addScaledVector(direction, distance),
      reachable: Math.abs(distance - requested) <= epsilon / 2,
    };
  }

  function connectLink(mesh, from, to) {
    const delta = to.clone().sub(from),
      length = delta.length();
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.scale.y = length;
    if (length > 1e-10)
      mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        delta.divideScalar(length),
      );
    return length > 1e-10;
  }

  function createCableTube({
    radius = 0.025,
    segments = 48,
    sides = 8,
    material,
  } = {}) {
    if (!(
      radius > 0 &&
      Number.isInteger(segments) &&
      segments >= 2 &&
      Number.isInteger(sides) &&
      sides >= 3
    ))
      throw new RangeError("Invalid cable dimensions");
    const geometry = new THREE.TubeGeometry(
      new THREE.LineCurve3(new THREE.Vector3(), new THREE.Vector3(0, -1, 0)),
      segments,
      radius,
      sides,
      false,
    );
    geometry.getAttribute("position").setUsage(THREE.DynamicDrawUsage);
    geometry.getAttribute("normal").setUsage(THREE.DynamicDrawUsage);
    const mesh = new THREE.Mesh(
      geometry,
      material ||
        new THREE.MeshStandardMaterial({ color: "#26383d", roughness: 0.8 }),
    );
    mesh.userData.mechanicalCable = { radius, segments, sides };
    mesh.frustumCulled = false;
    return mesh;
  }

  function updateCableTube(mesh, curve) {
    const config = mesh.userData.mechanicalCable;
    if (!config) throw new TypeError("Use a mesh from createCableTube");
    const { radius, segments, sides } = config;
    const positions = mesh.geometry.getAttribute("position"),
      normals = mesh.geometry.getAttribute("normal");
    const normal = new THREE.Vector3(),
      binormal = new THREE.Vector3(),
      radial = new THREE.Vector3();
    for (let ring = 0; ring <= segments; ring++) {
      const t = ring / segments,
        center = curve.getPoint(t),
        tangent = curve.getTangent(t).normalize();
      if (!ring) {
        normal.set(0, 0, Math.abs(tangent.z) < 0.9 ? 1 : 0);
        if (!normal.lengthSq()) normal.set(0, 1, 0);
      }
      normal.addScaledVector(tangent, -normal.dot(tangent));
      if (normal.lengthSq() < 1e-12) {
        normal.set(
          Math.abs(tangent.x) < 0.8 ? 1 : 0,
          Math.abs(tangent.x) < 0.8 ? 0 : 1,
          0,
        );
        normal.addScaledVector(tangent, -normal.dot(tangent));
      }
      normal.normalize();
      binormal.crossVectors(tangent, normal).normalize();
      for (let side = 0; side <= sides; side++) {
        const angle = (side / sides) * Math.PI * 2;
        radial
          .copy(normal)
          .multiplyScalar(-Math.cos(angle))
          .addScaledVector(binormal, Math.sin(angle));
        const vertex = ring * (sides + 1) + side;
        normals.setXYZ(vertex, radial.x, radial.y, radial.z);
        positions.setXYZ(
          vertex,
          center.x + radial.x * radius,
          center.y + radial.y * radius,
          center.z + radial.z * radius,
        );
      }
    }
    positions.needsUpdate = normals.needsUpdate = true;
    return mesh;
  }
  return { solveTwoBone, connectLink, createCableTube, updateCableTube };
}
