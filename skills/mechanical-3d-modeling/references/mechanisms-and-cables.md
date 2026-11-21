# Mechanisms and flexible cables

## Attachment frames before inverse kinematics

Choose a consistent convention, for example Y up, Z forward and model dimensions in arbitrary scene units. Use local coordinates for sockets and mounting plates. Transform an attachment with the moving body's quaternion and position; include its matrixWorld when ancestors or scale affect it. Position the cabinet independently and solve the support to that attachment.

The CRT example exposed two useful failure modes:

- Solving to the cabinet center let a forearm pass through the shell and emerge from its side.
- Moving the elbow completely behind the cabinet removed the collision but hid the mechanism. A pole direction toward the viewer's left, combined with modest rear clearance and appropriate framing, exposed the linkage.

These are separate problems. Sample both link segments in cabinet-local space, allowing for link radius, joint housings, and any paired-rail offsets. For box-like bodies, compare to an expanded local bounding box. For more complex geometry, use a suitable collision approximation. Then separately inspect the projected elbow and links against the body's silhouette and canvas bounds.

## Two-link reach

For lengths a and b and root-to-target distance d, the elbow's distance along the target axis is `(a*a - b*b + d*d) / (2*d)`, and its perpendicular offset is `sqrt(max(0, a*a - along*along))`. Project a preferred bend direction perpendicular to that axis. Provide a stable fallback if it is parallel.

Preserve segment lengths across motion. Clamp unreachable targets to a reachable effective wrist and expose that fact; do not claim the requested endpoint was reached. Keep targets slightly inside the reach limits to avoid a straight-arm singularity. Prefer adjusting feasible travel or link dimensions over visually stretching the arm.

The provided helper returns `{ elbow, wrist, reachable }`. `wrist` is the effective endpoint. The inputs are not mutated. The solver has no collision model; choose the pole and attachment path to fit the assembly.

```js
import * as THREE from "three";
import { createMechanicalTools } from "./three-mechanics.mjs";
const { solveTwoBone, connectLink } = createMechanicalTools(THREE);
const result = solveTwoBone(root, attachment, {
  upperLength: 1.3,
  lowerLength: 1.3,
  bendDirection: new THREE.Vector3(-1, 0, 0.35),
});
connectLink(upperMesh, root, result.elbow);
connectLink(lowerMesh, result.elbow, result.wrist);
```

The example lengths and pole are illustrative. `connectLink` expects a cylinder with unit height on local Y. If the imported link has another axis/length, adapt the transform instead of silently using these assumptions.

## Motion

Use elapsed time, cap long deltas after suspension, and damp with `1 - exp(-rate * dt)` rather than a fixed per-frame blend. Keep an extension target separate from its interpolated pose. Add small, bounded idle movements only when appropriate. A positive world yaw does not necessarily face the viewer's right: compare the head normal with the camera direction and verify on screen.

In the CRT, the user later requested a higher pose, so clearance had to be rechecked across extension, yaw and pitch. Do not validate just the pose that initially worked.

## Cables

Fix the ceiling end in world space and attach the other end to a local socket transformed with the body. Route a curve around the cabinet with slack below its bottom; keep return runs behind the shell. A local U-shaped guide curve with damping is sufficient for illustrative characters. It is not a length-conserving physical rope simulation; use an appropriate solver when that behavior matters.

Create tube geometry once and rewrite position/normal buffers at the paint rate. Preserve the winding of the original geometry: Three.js TubeGeometry's radial expression uses `-cos(theta) * normal + sin(theta) * binormal`. Check outward faces when changing the cross-section implementation. Transport the normal between rings to avoid abrupt twisting from a reference-axis switch.

The helper's `createCableTube` and `updateCableTube` accept any compatible Three.js curve. Generate the curve in the mesh parent's coordinates (identity scene parent is simplest). Fixed endpoints and socket transforms are the caller's responsibility. Its culling is disabled because its moving buffers have no static bounds. Dispose its geometry and owned materials on unmount.

Test endpoint coincidence, finite vertices/normals, outward winding, unchanged buffer identity during updates and clearance below the moving body. Disable decorative sway under reduced motion and pause updates while hidden.
