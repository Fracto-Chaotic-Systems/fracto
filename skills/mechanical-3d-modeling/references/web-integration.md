# Browser integration and visual verification

## Transparent compositing and lifecycle

For an overlay with no scene background, construct WebGLRenderer with `alpha: true`, leave `scene.background` null, use `setClearColor(0, 0)`, and keep wrapper/canvas CSS backgrounds transparent. Remove unwanted wall and ceiling meshes; alpha alone cannot make those meshes disappear. Preserve lighting without adding visible room geometry.

Resize from the actual available block, update camera aspect/projection and keep the renderer's backing resolution bounded (a device pixel ratio cap around 1.5 is often suitable for a small overlay). Measure consistently: getBoundingClientRect includes CSS transforms, so feeding transformed bounds back into a renderer with transformed CSS can accidentally double-scale it.

Keep frame data in mutable scene state rather than causing React to render at animation rate. Painting a small character around 24 fps can be sufficient; choose based on actual appearance/cost. Suspend animation when the document or component is hidden. Reduced motion should stop idle bobbing/blinking/sway and use immediate or otherwise appropriate user-driven poses. Cancel frame callbacks, disconnect observers, remove events, dispose textures/materials/geometries and the renderer at unmount. Deduplicate shared resources before disposal.

## Placement, scale and edge anchoring

Let the destination container own absolute position. For a user-requested 50px left shift, adjust the whole overlay by that amount; do not move only the head. Clip at the content edge when requested. Keep the model inside the fullscreen owner so it remains visible during fullscreen.

Canvas bounds and geometry silhouette differ. An overlay at top:0 can still have a bracket floating 15px below the edge. Project the stationary bracket bounds, find the top projected pixel, clear any prior view offset, then use camera.setViewOffset to shift the rendered image to the edge. Recalculate after resize. Keep top framing anchored independently of the moving head, so animation does not make the ceiling attachment drift.

For an exact 25% size increase, scale every term in a responsive clamp and its cap. Scaling only the preferred width can do nothing if a minimum/maximum is binding. Maintain the camera/aspect if increasing the whole canvas, or intentionally adjust projection if using a different approach. Budget transparent margins for joints/cables and check clipping from the actual camera. An oversized transparent canvas can be clipped by its parent while the visible geometry still fits, but assess narrow/short layouts rather than assuming it always will.

## Clicking a moving screen

For a model that reacts when its screen is clicked, remove separate action labels when asked. One browser-friendly option is a native button covering the canvas, clipped to a polygon projected from the screen's silhouette. Update that polygon after world matrices and camera projection are current, using the same frame as the render.

- Project rounded boundary vertices rather than the screen's axis-aligned bounding box.
- Convert NDC to CSS percentages: `x = (ndc.x + 1) * 50`, `y = (1 - ndc.y) * 50`.
- Start the clip path empty until the first valid pose has been projected.
- Use a localized accessible label, pressed state where appropriate, Enter/Space support and a visible focus tint.
- Make surrounding transparent areas pointer-events:none and enable pointer events only on the clipped button.

A Three.js raycaster is another valid option when the interaction requires actual mesh hit testing. Account for accessibility and touch rather than treating a canvas click listener as the entire interaction.

## Verify the destination

Read project run instructions and inspect existing service ports before starting a duplicate server. A standalone Vite page on the default port can appear broken if the active application uses a different port and backend discovery. Avoid changing authentication or fabricating backend data merely to preview a decorative model.

Use a fixture only when useful for isolating a renderer issue; then verify the actual page, content placement, stacking, screen interaction and end poses. Follow the available browser tool's screenshot/cleanup requirements. Save a screenshot when that tool requires proof of a UI change. If browser tooling is unavailable, report the limit and complete source checks without claiming visual success.
