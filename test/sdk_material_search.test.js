import assert from "node:assert/strict";
import test from "node:test";
import {
  empty_material_construction,
  material_view,
  validate_material_construction,
  validate_material_edit,
} from "@fracto/sdk/FractoMaterialMetadata.js";
import {
  search_materials,
  validate_material_query,
} from "@fracto/sdk/FractoMaterialSearch.js";
import { environment_registration } from "@fracto/sdk/FractoEnvironmentCatalog.js";
const revision = "a".repeat(64);
const view = (id, extra = {}) =>
  material_view(
    {
      id,
      name: id,
      category: "vegetation/grass",
      description: "",
      tags: [],
      ...extra,
    },
    revision,
  );
test("legacy materials stay unknown and projections exclude unrelated provenance and extensions", () => {
  const material = view("grass", {
    original_location: "private",
    account_id: "private",
    attribution: { creator_name: "private" },
  });
  assert.equal(material.placement_ready, false);
  assert.equal(material.construction.dimensions_m, null);
  assert.ok(material.missing_metadata.includes("ground_anchor_m"));
  assert.ok(!JSON.stringify(material).includes("private"));
  const registration = environment_registration(
    {
      id: "grass",
      name: "Grass",
      version: "1",
      tags: ["grass"],
      construction: empty_material_construction(),
      history: [],
      sources: [],
    },
    revision,
  );
  assert.equal(registration.record.construction, undefined);
  assert.equal(registration.record.tags, undefined);
});
test("verified model/surface facts become ready and unsafe geometry/units are rejected", () => {
  const construction = {
    ...empty_material_construction(),
    kind: "model",
    source_units: "cm",
    meters_per_unit: 0.01,
    dimensions_m: [2, 3, 2],
    up_axis: "y",
    forward_axis: "z",
    ground_anchor_m: [0, -1, 0],
    footprint_m: [2, 2],
    placement: "ground",
  };
  assert.equal(view("tree", { construction }).placement_ready, true);
  assert.equal(
    view("dirt", {
      construction: {
        ...empty_material_construction(),
        kind: "surface",
        placement: "floor",
        texture_size_m: [2, 2],
      },
    }).placement_ready,
    true,
  );
  for (const change of [
    { dimensions_m: [Infinity, 1, 1] },
    { meters_per_unit: 1 },
    { ground_anchor_m: [0, 0] },
    { forward_axis: "-y" },
    { footprint_m: [0, 1] },
    { shader: "arbitrary" },
  ])
    assert.throws(
      () => validate_material_construction({ ...construction, ...change }),
      /invalid_material_metadata/,
    );
  assert.throws(
    () =>
      validate_material_edit({
        revision,
        description: "",
        tags: ["x".repeat(65)],
        construction,
      }),
    /invalid_material_metadata/,
  );
});
test("search ranks catalog fields deterministically, supports filters and reports gaps", () => {
  const materials = [
    view("a", { name: "Grass", tags: ["grass"] }),
    view("b", { name: "Patch", description: "Grass ground cover" }),
    view("c", { name: "Shrub", category: "vegetation/shrub" }),
  ];
  const result = search_materials(
    materials,
    { q: "grass", limit: 1 },
    revision,
  );
  assert.deepEqual(
    result.materials.map((m) => m.id),
    ["a"],
  );
  assert.equal(result.total, 2);
  assert.equal(result.next_offset, 1);
  assert.equal(
    search_materials(
      materials,
      { q: "grass", offset: 1, snapshot: revision },
      revision,
    ).materials[0].id,
    "b",
  );
  assert.deepEqual(
    search_materials(materials, { q: "purple grass" }, revision)
      .unmatched_terms,
    ["purple"],
  );
  assert.equal(
    search_materials(materials, { category: "vegetation/shrub" }, revision)
      .total,
    1,
  );
  assert.equal(
    search_materials(materials, { placement: "ground" }, revision).total,
    0,
  );
  assert.throws(
    () =>
      search_materials(
        materials,
        { offset: 1, snapshot: "b".repeat(64) },
        revision,
      ),
    /material_search_changed/,
  );
  for (const query of [
    { q: ["grass"] },
    { limit: 100 },
    { offset: 1 },
    { offset: "1e2" },
    { arbitrary: true },
  ])
    assert.throws(
      () => validate_material_query(query),
      /invalid_material_query/,
    );
});
