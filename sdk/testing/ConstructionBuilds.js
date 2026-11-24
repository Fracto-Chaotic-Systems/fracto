import { create_component_document } from "../FractoComponentDocument.js";
import {
  empty_material_construction,
  material_view,
} from "../FractoMaterialMetadata.js";
import {
  apply_component_commands,
  component_reference_key,
} from "../FractoComponentTools.js";

// Synthetic calibrated assets only. Never substitute these facts into a live catalog.
export function construction_fixture_materials() {
  const entries = [
    ["dirt", [1, 0, 1]],
    ["grass", [0.3, 0.4, 0.3]],
    ["shrub", [0.8, 1, 0.8]],
    ["tree", [2, 5, 2]],
  ];
  return Object.fromEntries(
    entries.map(([id, dimensions], i) => {
      const facts = {
        ...empty_material_construction(),
        kind: id === "dirt" ? "surface" : "model",
        placement: id === "dirt" ? "floor" : "ground",
        ...(id === "dirt"
          ? { texture_size_m: [1, 1] }
          : {
              source_units: "m",
              meters_per_unit: 1,
              dimensions_m: dimensions,
              footprint_m: [dimensions[0], dimensions[2]],
              up_axis: "y",
              forward_axis: "z",
              ground_anchor_m: [0, 0, 0],
            }),
      };
      const material = material_view(
        {
          id,
          name: id,
          category: "evaluation",
          tags: [id],
          description: "Synthetic calibrated evaluation material",
          construction: facts,
        },
        ["a", "b", "c", "d"][i].repeat(64),
      );
      return [
        component_reference_key(material),
        {
          material,
          runtime: {
            id,
            model: id === "dirt" ? null : `${id}.glb`,
            format: id === "dirt" ? null : "glb",
            resources: [id === "dirt" ? "dirt.png" : `${id}.glb`],
          },
        },
      ];
    }),
  );
}
export function construction_builds(uuid) {
  const materials = construction_fixture_materials();
  const ref = (id) => {
    const { material } = Object.values(materials).find(
      (entry) => entry.material.id === id,
    );
    return { id, revision: material.revision };
  };
  const base = (name) => create_component_document(uuid(), name);
  const floor = (size, textured = true) => ({
    type: "set-floor",
    floor: {
      asset: textured ? ref("dirt") : null,
      size,
      texture_repeat: textured ? size : [1, 1],
      texture_file: textured ? "dirt.png" : null,
    },
  });
  const scatter = (id, count, bounds, exclusions, seed) => ({
    type: "scatter",
    rule: {
      id: uuid(),
      asset: ref(id),
      group_id: null,
      algorithm: "footprint-xz-v1",
      seed,
      count,
      bounds,
      exclusions,
      scale: [1, 1],
    },
  });
  const wooded = (width = 2) => [
    floor([8, 20]),
    ...["grass", "shrub", "tree"].map((id, i) =>
      scatter(
        id,
        [40, 6, 4][i],
        [-4, -10, 4, 10],
        [[-width / 2, -10, width / 2, 10]],
        17 + i,
      ),
    ),
  ];
  const builds = [
    {
      id: "plain-floor",
      brief:
        "A plain neutral floor exactly 4 meters wide and 12 meters deep. No textures, materials or objects.",
      base: base("Evaluation plain floor"),
      commands: [floor([4, 12], false)],
      expected: { floor_size: [4, 12], counts: {}, corridor_width: 0 },
    },
    {
      id: "wooded-path",
      brief:
        "Build an 8 by 20 meter dirt floor with 40 grass clumps, 6 shrubs and 4 trees. Keep a centered 2 meter wide walking corridor clear of full footprints.",
      base: base("Evaluation wooded path"),
      commands: wooded(),
      expected: {
        floor_size: [8, 20],
        counts: { grass: 40, shrub: 6, tree: 4 },
        corridor_width: 2,
        area: [-4, -10, 4, 10],
      },
    },
    {
      id: "cross-path-meadow",
      brief:
        "A 10 by 10 meter dirt floor with 50 grass clumps. Keep two crossing 2 meter wide walking strips clear along the X and Z axes.",
      base: base("Evaluation cross-path meadow"),
      commands: [
        floor([10, 10]),
        scatter(
          "grass",
          50,
          [-5, -5, 5, 5],
          [
            [-1, -5, 1, 5],
            [-5, -1, 5, 1],
          ],
          31,
        ),
      ],
      expected: {
        floor_size: [10, 10],
        counts: { grass: 50 },
        exclusions: [
          [-1, -5, 1, 5],
          [-5, -1, 5, 1],
        ],
        area: [-5, -5, 5, 5],
      },
    },
  ];
  builds.push({
    id: "garden-placements",
    brief:
      "A 10 by 10 meter dirt floor. Place 3 shrubs at (-4,0,-3), (4,0,-3), (-4,0,3) and 2 trees at (-3,0,0), (3,0,0), with unit scale and zero rotation. Keep a 2 meter centered corridor clear.",
    base: base("Evaluation garden placements"),
    commands: [
      floor([10, 10]),
      ...[
        ["shrub", [-4, 0, -3]],
        ["shrub", [4, 0, -3]],
        ["shrub", [-4, 0, 3]],
        ["tree", [-3, 0, 0]],
        ["tree", [3, 0, 0]],
      ].map(([id, position]) => ({
        type: "place",
        object: {
          id: uuid(),
          asset: ref(id),
          position,
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          group_id: null,
        },
      })),
    ],
    expected: {
      floor_size: [10, 10],
      counts: { shrub: 3, tree: 2 },
      corridor_width: 2,
      area: [-5, -5, 5, 5],
    },
  });
  const initial = apply_component_commands(
    base("Evaluation refinement"),
    [
      floor([8, 20]),
      {
        type: "place",
        object: {
          id: uuid(),
          asset: ref("tree"),
          position: [2, 0, 3],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          group_id: null,
        },
      },
      scatter("shrub", 4, [-4, -10, -1, 10], [], 41),
    ],
    materials,
  );
  builds.push({
    id: "refinement",
    brief:
      "Move the existing tree to X=-2.3, Y=0, Z=4. Rotate it 0.4 radians about Y, scale uniformly to 1.2, and remove the shrub scatter. Keep the floor.",
    base: initial,
    commands: [
      {
        type: "transform",
        id: initial.objects[0].id,
        position: [-2.3, 0, 4],
        rotation: [0, 0.4, 0],
        scale: [1.2, 1.2, 1.2],
      },
      { type: "remove", id: initial.scatters[0].id },
    ],
    expected: {
      floor_size: [8, 20],
      counts: { tree: 1 },
      area: [-4, -10, 4, 10],
      position: [-2.3, 0, 4],
      scale: [1.2, 1.2, 1.2],
    },
  });
  const memory_base = base("Evaluation remembered path");
  const memory_expected = {
    floor_size: [8, 20],
    counts: { grass: 40, shrub: 6, tree: 4 },
    corridor_width: 3,
    area: [-4, -10, 4, 10],
  };
  builds.push({
    id: "memory-without-guidance",
    brief:
      "Build an 8 by 20 meter dirt path with 40 grass clumps, 6 shrubs and 4 trees.",
    base: memory_base,
    commands: wooded(2),
    expected: memory_expected,
    expected_pass: false,
  });
  builds.push({
    id: "memory-with-guidance",
    brief: builds.at(-1).brief,
    guidance: [
      {
        kind: "preference",
        instructions:
          "Walking corridors must be 3 meters wide, with full footprints outside the corridor.",
      },
    ],
    base: memory_base,
    commands: wooded(3),
    expected: memory_expected,
  });
  builds.push({
    id: "current-direction-override",
    brief: builds[1].brief,
    guidance: [
      {
        kind: "preference",
        instructions: "Prefer 3 meter wide walking corridors.",
      },
    ],
    base: base("Evaluation current override"),
    commands: wooded(2),
    expected: builds[1].expected,
  });
  for (const build of builds) {
    const f =
      build.commands.find((command) => command.type === "set-floor")?.floor ||
      build.base.floor;
    build.expected.floor_material = f?.asset?.id || null;
    build.expected.texture_repeat = f?.texture_repeat;
  }
  return { materials, builds };
}
