# Cached terrain tiles

`Plan.js` selects a native tile level for a display region and lists indexed
short codes, mirrored instances and missing coverage. `Mesh.js` builds a
normalized 257×257 mesh from a 256×256 numerical source tile. `Cache.js` stores
versioned gzip-compressed binary attributes and a region assembly manifest.
`Worker.js` runs a cache job separately from the HTTP server.
`Paths.js` owns mesh path conventions and storage initialization. `Storage.js`
loads and validates a complete compressed file, optionally decoding its typed
attributes for runtime use. Importing these modules creates no directories.
`Inventory.js` provides the independent, in-memory mesh availability index used
as the foundation for heat-map queries. It performs no filesystem access.

Mesh X/Z coordinates span 0–1; Z runs from complex-plane top toward bottom.
Heights are normalized log1p(iteration)/log1p(1000000), capped at 1 and smoothed
with the radius-two Gaussian at 100%. Assembly must scale X/Z by tile width and
Y by the **whole navigator scope / 25**, not by each tile's width. Bounds and
mirrored placements come from the assembly manifest. Normals are omitted.

Edges currently clamp to local source samples, including the extra boundary
row/column. Neighbor lookup and cross-level stitching are deferred; manifests
explicitly mark this provisional boundary policy. Missing indexed tiles and
failed reads are reported as gaps, never silently rendered as zero-height data.

Raw signed pattern IDs and Float64 iteration values accompany each mesh so a
later assembler can derive the existing view-dependent standard palette across
all visible tiles. Colors are not independently baked per tile.

The active tile directory determines the mesh root; arbitrary mesh-directory
overrides are not supported:

- Remote-cache mode: `FRACTO_TILE_DATA_DIR/meshes/`, default `tiles/meshes/`.
  Mirror the cache's four-character shortcode directories, including a full
  final group: `meshes/0123/0123/0123012301.gz`.
- Local-source mode: `FRACTO_TILE_SOURCE_DIR/meshes/`, mirroring source releases:
  `meshes/L10/0123012301.gz`.

Only quadtree shortcodes containing 0–3, length 2–34, are accepted. Mesh files
have the same names and directory layout as their corresponding numerical
tiles, beneath `meshes/`. Each file contains positions, UVs, triangle indices,
raw pattern IDs, raw iteration values, bounds, coordinate/height conventions,
source checksum, and the immutable build profile. No numerical tile read is
needed to load a stored mesh. Runtime palette calculation and coordinate/height
scaling still depend on the assembled view, as described above.

An identity hash inside each file binds the source/index and build profile.
Changing either replaces a mesh at the same shortcode path on the next build;
stale identities are rejected by service retrieval. Assembly manifests live
under `meshes/manifests/<identity>/`. Older manifests must be regenerated after
source changes; they do not provide immutable historical mesh snapshots.

The binary format is little-endian, with an 8-byte magic, a
uint32 JSON-header length and reserved uint32, an 8-byte-padded JSON header,
then 8-byte-aligned typed attributes described by byte offsets and lengths.
Gzip protects the complete payload; decoding validates offsets and counts.
Writes use temporary files followed by rename. Existing valid files are reused;
corrupt files are rebuilt. Region manifests store relative file paths and tile
bounds for later assembly. Source contents are hashed in every built tile;
remote source replacement without an index/generation change requires an
explicit rebuild/new source identity.

## Initialization and access

Run `npm run meshes:init` from the root with the same source environment as the
service. This creates `meshes/`, records schema/layout/encoding in
`.fracto-mesh-store.json`, and checks atomic writing, renaming, and reading.
Repeated runs are safe. The tiles service performs this check before listening,
and cache jobs repeat it before building. Failures are fatal to startup; there
is no fallback directory. Numerical tiles are never modified by initialization.
`FRACTO_TILE_MIN_FREE_BYTES` also protects mesh writes (default 1 GiB).

For remote-cache Docker deployments, the existing tile-data volume contains
both numerical tiles and the writable meshes subtree. Development keeps
`FRACTO_TILE_CACHE_READ_ONLY=true` to disable numerical cache writes while
allowing mesh writes. Recreate the development container after the mount change.

For local-source deployments, prepare the directory on the source host before
starting Compose, granting the service UID write/search permissions there:

```sh
npm run meshes:init -- --tiles-directory /path/to/tile-source --layout level
```

`compose.local-tiles.yaml` mounts the numerical source read-only and overlays
only that source's `meshes/` directory as writable at the matching container
path. `create_host_path: false` requires explicit preparation and prevents an
accidental empty directory on the wrong disk. The source volume must have
space for the meshes. Include this subtree in volume backup/restore plans.

Server-side consumers call `read_mesh_file(short_code, { source_identity })`
from `@fracto/sdk/terrain/Storage.js`; the result includes gzip bytes and typed
attributes. HTTP consumers use the authenticated tiles route
`GET /meshes/:short_code`. The response is a gzip asset rather than transparent
HTTP compression, allowing clients to retain/cache the complete binary file.

The former service-local terrain cache is not migrated or deleted automatically;
rerun its selected-entry build to populate the shared-volume store.

## Mesh availability inventory (step 1)

`MeshInventory` is available from `@fracto/sdk/terrain/Inventory.js`. Construct
it with the active source identity used by mesh storage. The current build
profile is included in the resulting namespace hash, matching file metadata.
The source identity is fixed for an inventory instance; a source change creates
a new instance and reclassifies loaded records against that identity.

The inventory accepts one explicit observation per exact shortcode:

```js
const inventory = new MeshInventory(source_identity);
inventory.upsert({
  short_code,
  namespace: decoded.metadata.namespace,
  compressed_bytes: compressed.length,
  sha256: compressed_file_checksum,
  status: "ready",
});
```

Only a caller that has validated a stored file may insert it as ready. Its
namespace must identify the file's source/profile, not be replaced with the
active namespace. A mismatched namespace is reported as `stale` automatically.
An unreadable/corrupt file may be recorded with `status: "invalid"`; unknown
namespace/checksum values may be null in that case. `stale` is derived, never
supplied as a validation status. Fields are allowlisted and validated; level and
bounds are always derived from the shortcode.

- `has(code)` tests indexed file presence, including stale/invalid observations.
- `has_ready(code)` tests current, validated availability.
- `get(code)` returns copied metadata and effective status, or null if absent.
- `remove(code)` removes the observation from exact and spatial lookups.
- `summary()` reports counts and compressed bytes overall and by level.
- `revision` changes on actual inserts, updates, or removals; repeated identical
  observations do not change it.
- `epoch` (reported as `inventory_epoch`) identifies this inventory's revision
  history. It survives snapshot reload. Rebuilding without a usable snapshot
  creates a new epoch so clients refresh even if the revision number repeats.

`tiles_in_scope(level, focal_point, scope, aspect_ratio, options)` returns copied
records with canonical bounds, ordered by left coordinate then descending top.
The inventory maintains independent columns per level and binary-searches
columns and rows. Sorted spatial arrays are built lazily and invalidated only
for the level that changed. Queries use positive-area intersections: touching
an edge alone does not count as coverage. Levels 2–34 are supported.

Queries include ready meshes only unless `include_unavailable: true` is set.
Upper-half-plane meshes also match reflected negative-imaginary views unless
`mirror_y: false` is set. Results contain each shortcode once, even for a view
crossing the real axis; bounds remain canonical so heat-map rasterization can
place both images. Explicit lower-half files are queried at their actual bounds.

Neither numerical tile coverage nor a parent/child mesh implies membership.
No numerical index, bailiwick manifest, directory scan, or mesh decode is used
for queries. Presence means the last indexed observation; it is not a live
filesystem check or proof of a hole-free terrain surface.

The tiles service now owns this inventory through `InventoryStore.js`, which
serializes filesystem observations and durable updates. `HeatMap.js` now
provides the mesh heat-map query and rasterization. The transforms page now
displays that map alongside its independently persisted navigator.

## Persistent inventory lifecycle (step 2)

`InventoryJournal.js` persists `inventory.json` and
`inventory.journal.ndjson` in the mesh root. The snapshot stores raw validation
states, file signatures, pending publication intents, sequence and revision.
Journal records are appended and fsynced before memory is updated. Snapshot
replacement uses a fsynced temporary file, atomic rename, and directory fsync
where the OS supports it. Snapshots publish before the journal is compacted;
replay ignores events already covered by the snapshot. Mesh file publication
uses the same durable replacement helper in `DurableFile.js`.

The service loads the snapshot and journal before listening, reclassifying file
identities against its current source/profile. Ordinary warm startup performs
no mesh-tree scan or decompression; only pending publication intents are
rechecked. No snapshot, corrupt metadata, a torn journal, or a sequence gap
triggers a full scan of the canonical mesh paths before the service becomes
ready. Initial startup thus discovers meshes built before inventory support.
Corrupt and incompatible files are invalid; valid older source identities are
stale. Corrupt snapshot recovery can start a new revision history if no valid
baseline survives; its new inventory epoch makes that reset observable to
clients. Legacy snapshots without an epoch receive one on load and persist it
at the startup checkpoint, without rescanning valid meshes. The mesh files
remain authoritative.

Before replacing a file, a construction worker waits for the service to journal
a `begin` intent. Existing availability is conservatively invalidated while
that file is pending. After atomic publication (or reuse), the worker waits for
the service to inspect and journal the stored bytes before reporting progress.
Worker completion, error, exit and timeout terminate the worker before recovering
pending intents and compacting the index. A crash before publication cannot
create a ready entry; a crash after publication is recovered from that file.
Inventory append failures stop further writes until restart/recovery instead
of allowing unsaved changes to appear as durable availability.

GET `/mesh_inventory` reports current summary counts and revision. POST
`/mesh_inventory/reconcile` performs an explicit full integrity reconciliation
and checkpoints the result. Both inherit tiles-service authentication and the
POST inherits mutation-origin checks. No machine paths or file error details
are returned. There is deliberately no second standalone index writer: use the
service route for external filesystem changes. Run only one tiles-service
inventory owner per mesh volume; multi-process/multi-host writers are unsupported.

Reconciliation ignores manifests, temporary files, symlinks, and files outside
the selected canonical path convention. It discovers additions, updates changed
or invalid files, and removes deleted files without modifying mesh data. It
skips active worker intents, which are finalized by the worker handshake or
failure recovery. SDK `reconcile()` normally checks size/inode/timestamps to
avoid decoding unchanged files; `{ force: true }` verifies all bytes. Ordinary
retrieval also observes the file, invalidating missing/corrupt entries and
discovering files absent from the index. Stable read-back checks guard against
atomic replacement races. Spatial queries remain entirely in memory.

External additions, deletions or edits are reconciled explicitly; a filesystem
watcher is not required or installed. A stored ready mesh can have geometry
holes: availability continues to describe the mesh file, not full surface
coverage.

## Mesh heat-map endpoint (step 3)

GET `/mesh_heat_map_buffer` accepts `width_px`, `focal_point_x`,
`focal_point_y`, `scope`, and optional `aspect_ratio` (default 1). It uses the
service-owned in-memory inventory only: no directory scans, mesh decompression,
numerical tile reads, or construction. The synchronous lookup/raster operation
returns one consistent inventory revision.
`TileCounts.js` also counts numerical tile availability from the service's
already-loaded compiled index, without reading tile files or allocating tile
records. It does not assume source columns/rows are sorted. Canonical counts
use the same positive-area and reflected-view rules as mesh queries.

The response includes:

- `heat_map_buffer[x][y]`: `[0, level]`, compatible with the existing SDK heat-map
  renderer. Level 0 means no ready mesh; levels 2–34 identify mesh resolution.
  The ordinary tile heat map's default level 4 is deliberately not used for
  uncovered mesh pixels.
- `coverage`: ascending rows of `{ level, tile_count, mesh_count, can_do,
  compressed_bytes, pixel_count }`. Tile count is the number of indexed
  numerical tiles intersecting the view; mesh count counts current ready meshes.
  Can do is exactly `tile_count - mesh_count`, without clamping. Levels with
  numerical tiles and zero meshes are included. Direct SDK consumers can omit
  the `count_tiles_in_scope` provider for mesh-only results; production injects
  the compiled tile index counter. Counts describe distinct canonical files intersecting
  the view. Pixel counts describe the final visible level after overlap; a mesh
  smaller than a pixel can contribute zero visible pixels. Mirrored instances
  do not double the mesh count or compressed size. Stale and invalid meshes
  are excluded. Tile-generation classifications are not included.
- `inventory_revision`, `inventory_epoch`, `namespace`, `width_px`, `height_px`,
  `uncovered_pixel_count`, and lookup/raster/total `timings_ms`.

Height is `round(width_px * aspect_ratio)` without truncating odd dimensions.
Samples are pixel centers with left/top inclusive and right/bottom exclusive
tile boundaries. Highest available level wins at each sample. Upper-half
meshes are also painted at their reflected negative-imaginary bounds, including
meshes touching the real axis. Explicit lower-half meshes paint at their own
bounds. Areas outside coverage remain level 0; no parent or child is inferred.

Validation rejects malformed, non-finite, unrepresentable, or oversized views
with 400. Each edge is limited to 2048 pixels, total pixels to 1,048,576, and
intersecting ready meshes to 100,000 across all levels. The inventory's optional
query `limit` stops collection before excess records are materialized. Exceeding
the mesh budget returns 422 rather than an incomplete map; other failures return
a generic 503. Successful responses use `Cache-Control: no-store` so inventory
changes can be seen without moving the navigator. The endpoint inherits existing
tile-service authentication.

## Lifecycle verification (step 5)

The lifecycle integration suite joins construction, persistence, retrieval,
reconciliation and heat-map HTTP responses in both storage layouts. It also
kills a separate process at durable publication boundaries. See
`test/MESH_LIFECYCLE.md` for the verification matrix and commands. Client refresh
identity is the combination of inventory epoch, source/profile namespace and
revision; a damaged snapshot rebuild must not leave a stationary view stale.

### Manual region transforms

TransformPlan.js selects missing, stale or invalid meshes from the compiled tile index at the clicked level in the captured navigator region. Canonical files are selected once for mirrored coverage. The supplied count must match current availability (HTTP 409 otherwise); the batch limit is 200,000 tiles. Region manifests describe the selected pending tiles and live under manifests/<namespace>/region-level-<level>-<regionhash>.json. Existing bailiwick plans retain their original format. Workers release each decoded source tile after processing to bound batch memory. Insufficient mesh capacity aborts immediately while retaining completed meshes.

Decode.js validates decompressed FTMESH01 bytes in both Node and browsers; Cache.js retains the bounded gzip decoder for server use. Profile.js contains the unchanged shared mesh profile. Mesh progress marks successful publications with mesh_ready; the queue exposes preview_short_code only after a mesh is durably indexed.

### Runtime terrain manifests

RuntimePlan.js chooses a single ready base mesh level for a navigator region and minimum resolution (2–5000 on the shorter axis). It prefers complete indexed coverage at the coarsest sufficient available level, then complete coarser coverage, then a partial candidate. Base mesh selection is capped at 256 canonical files; child-candidate metadata is additional, and mirrored placements share those files. Missing indexed files, unmet minimums, empty selections and actual native resolution are explicit. Manifest fields are allowlisted and include inventory epoch/namespace/revision and each file checksum. No storage reads or construction occur during planning. Palette.js combines raw pattern/iteration histograms across visible tile placements for consistent standard colors. FractoCanvasBuffer optionally accepts these shared tone maps; default rendering is unchanged. Decode.js also exposes bounded browser-native gzip decoding.

The runtime manifest reports limiting_reason as mesh_budget or availability when the requested minimum is unmet. The 256-file limit allows the 3500-sample overview to select level 5 instead of being forced down to level 4 by the former 64-file cap. Decoded-tile retention remains 64 entries; the active render can contain more files.

### One-level adaptive detail

Lod.js enumerates only complete ready child quartets for each physical base-tile placement. Runtime manifests include these candidates as refinements; no child assets are loaded by that endpoint. request_lod_plan includes base parents as fallbacks and deduplicates requested child files. resolve_lod_plan replaces only the selected physical placement when all four children loaded successfully, preserving mirrored parents elsewhere and retaining parents for failed quartets. The base selection still has its 256-file limit; up to eight local groups add at most 32 child files. Seam stitching remains deferred. Palette.js extends a fixed base-view tone mapping to finer-only iteration values by interpolation, so moving the camera does not recolor distant terrain or change the common scope/25 height scale.
