---
name: mechanical-3d-modeling
description: "Create or refine procedural 3D mechanical devices and animated assemblies in Three.js, including articulated mounts, robot-like motion, flexible cables, and weathered materials. Use for interactive browser models and mechanical characters. For fabrication CAD or STEP output, use an appropriate CAD tool rather than treating a render mesh as an engineering model."
---

# Mechanical 3D Modeling

Build inspectable, editable geometry with convincing mechanical connections and verify it in the user's actual destination. Extend the existing renderer and component architecture when available.

## Establish the model and destination

Determine the intended deliverable from the request and repository: interactive scene, visual concept, exportable mesh, or dimensioned CAD. Resolve coordinate axes, scale, fixed anchors, moving bodies, joint ranges and the intended camera before building. For mechanical characters, distinguish expressive swivel/tilt/roll from the arm's extension/retraction.

For application integration, identify the specific content container, fullscreen owner and overlay stacking order. "Upper left of Game Play" means its content area when that is what the user specifies; a nearby sidebar is a different destination. Preserve the user's chosen size, direction, offsets, transparency and interaction during later edits. Do not turn the CRT example's layout or aesthetic into defaults for unrelated projects.

## Build and animate

- Keep geometry/material construction, pose calculations and renderer lifecycle separate when their complexity warrants it. Let the outer page own placement and available dimensions.
- Build a hierarchy around actual attachment frames. A wrist attaches to a mounting plate on a moving cabinet, not to the cabinet's center. Convert that local attachment into world coordinates before solving the arm.
- Read [mechanisms-and-cables.md](references/mechanisms-and-cables.md) for arm reach, elbow visibility, collision checks, flexible cabling and the reusable mechanics asset.
- Read [materials.md](references/materials.md) when adding aged plastic, gritty metal, vents, or curved display glass. Copy/adapt the relevant material asset into the project; these assets generate textures locally and accept the project's Three.js namespace.
- Read [web-integration.md](references/web-integration.md) for transparent compositing, edge anchoring, moving screen hit targets, camera framing, reduced motion and cleanup.

The portable helpers in [three-mechanics.mjs](assets/three-mechanics.mjs) expose a two-link solver and reusable cable buffers. They require Three.js supplied by the consuming project, not a globally installed dependency. They are examples to adapt, not a mandatory framework.

## Verify and deliver

Check observable mechanical invariants: fixed link lengths, reachable endpoints, transformed mounting points, cabinet clearance through the complete travel, fixed ceiling cable ends, and finite geometry. Define what must be visible from the actual camera separately from collision clearance; a correctly hidden rear arm may still fail a request for a visible left elbow.

For meaningful changes to the helper assets, run:

```text
node <skill-directory>/scripts/verify-mechanics.mjs --project-root <project-with-three-installed>
```

Do not install a dependency solely to run this check when a suitable project is already available. If no Three.js runtime is present, report that limit and validate the relevant source without claiming an executed geometry check.

Use the project's required formatter and checks. Verify visual changes in the real content area, at the relevant viewport size, in extended and retracted poses. A fixture helps isolate startup problems but does not replace checking the actual page. Inspect existing service configuration before launching another server; verify the active app's host and port. Refresh its watcher using project instructions when host edits do not propagate.

Use the available supported browser tool for visual QA. Do not claim live verification if tooling or backend access prevents it. Describe the implemented result, the checks actually performed and any remaining limitation. Update nearby project documentation for new module responsibilities and lifecycle behavior.
