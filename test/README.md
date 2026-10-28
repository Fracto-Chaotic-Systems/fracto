# Fracto tests

Root tests use Node's built-in test runner and cover SDK, service, script and
integration behavior. Run the maintained suite with `npm test`; run a focused
file with `node --test test/<file>.test.js`.

`terrain_mesh_cache.test.js` covers native-level planning from saved bailiwick
regions, normalized mesh geometry, binary round trips, cache reuse, corrupt
cache recovery, partial coverage and queued-job API behavior. It uses synthetic
numerical tiles and temporary directories; it does not require a running DB or
tile service. Live cache jobs can be started from the freeform page's test button.

`mesh_storage.test.js` covers active-volume path selection, both tile-compatible
directory layouts, initialization/read-back and idempotence, preservation of
numerical tiles, incompatible stores, traversal rejection, complete typed-array
round trips and the compressed retrieval route's 200/400/404/409/503 behavior.
`npm run test:terrain-cache` runs the mesh cache, storage, and inventory tests
without live services.

`mesh_inventory.test.js` checks exact membership, source/profile availability,
per-level totals, defensive copies, revision semantics, updates/removals after
spatial caching, mirrored coverage, aspect ratios, boundary-only intersections,
and levels 2–34. Spatial results are compared with a brute-force reference over
mixed-status records and multiple viewports. Invalid inputs cannot mutate the
index. Run it separately with `npm run test:mesh-inventory`.

`mesh_inventory_store.test.js` verifies cold indexing, warm startup without mesh
decoding, source changes, uncheckpointed replay, interrupted file publication,
torn/corrupt metadata recovery, compaction ordering, external additions/deletions,
corrupt-file invalidation, active-worker reconciliation, cache hooks, retrieval
repair, worker acknowledgments and failure recovery. Tests use temporary stores
and synthetic numerical data; no live services are required.

`mesh_heat_map.test.js` covers ready-only availability, empty regions, overlap
precedence, mirrored/real-axis coverage, rectangular views, level 34, subpixel
meshes, boundary rounding, request limits, bounded inventory collection, and
sanitized endpoint failures. Raster results are checked against a direct
pixel-center reference. Run it with `npm run test:mesh-heat-map`.
