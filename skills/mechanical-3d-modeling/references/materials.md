# Materials and small mechanical details

Prefer procedural geometry and locally generated texture maps when the asset should remain editable and lightweight. Use a raster-generation workflow when the brief benefits from authored photographic imagery; this skill does not require that for every finish.

## Aged plastic

The portable [aged-plastic.mjs](../assets/aged-plastic.mjs) creates a deterministic finish with yellowing, broad mottling, seam grime, molded grain and small scuffs. Call `createAgedPlastic(THREE)` in a browser or provide a compatible canvasFactory. It returns `shell` and `bezel` materials sharing generated maps. Adapt tint, scale and wear intensity to the design rather than applying beige to every object.

Separate pigment from lighting response: color uses sRGB, bump/roughness maps are linear data textures. Use low metalness, high roughness and a subtle bump scale for old ABS. Texture generation happens at construction, not during animation. Preserve the glass material when aging only the casing.

## Gritty metal

[weathered-metal.mjs](../assets/weathered-metal.mjs) exposes `createWeatheredMetal(THREE, options)` and returns `dark`, `steel`, and `brass` variants sharing color, bump, roughness and metalness maps. Apply to the requested armature pieces: ceiling plate, links, joint housings and cradle. Avoid assigning rusty metal materials to rubber cables or display glass.

Rust patches reduce metallic reflectance and increase roughness; pits affect bump response, while bright short scratches suggest exposed substrate. Keep localized wear and some surviving original finish. Verify at the model's actual on-screen size: subtle micrograin alone can vanish on a 20px-wide link, while oversized noise can resemble stone.

Both material assets accept an optional canvasFactory, defaulting to browser document.createElement. They have no project-specific imports, file paths, network calls or animation state. Import the project's Three.js namespace, copy the asset into the source tree, and pass that namespace. Dispose the shared maps only once along with the owning scene.

## Vents and curved glass

Place vents on the side actually visible from the chosen camera. Small dark inset faces, grime rims and raised molded lips can convincingly imply depth without destructive geometry changes. Actual cutouts may be required for exported fabrication geometry. Keep slot extents on the case's flat region rather than letting them float over rounded corners.

For a rounded CRT-style screen, a superellipse boundary plus concentric rings and a shallow convex Z profile gives both rounded corners and bulging glass. Verify normals point forward and UVs stay bounded. Use restrained glass clearcoat and reflection; keep decorative scan lines/emission local to the screen texture. This is an example shape, not a required appearance for other devices.
