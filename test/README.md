# Fracto tests

`chat_stream.test.js` covers incremental UTF-8/NDJSON framing, completion/error
semantics, size limits, backpressure, browser accumulation, and streaming through
both HTTP hops. Delayed fixtures verify first text arrives before completion;
Stop and timeouts abort model work. Engine tests also cover Ollama streaming and
provider metadata filtering. No real model or machine credential is required.

`admin_chat.test.js` verifies the admin chat bridge's origin/session enforcement,
bounded text contract, server-only credentials, response filtering, fixed errors
and timeout cancellation using local HTTP fixtures. It requires no running AI
engine, model, database or real machine token.

`servers/fracto-ui/test/admin_chat_messages.test.js` covers text-file extraction,
UTF-8/JSON validation, file size/count bounds, local attachment lifecycle,
file-only messages and combined/escaped context limits. The admin bridge test
also verifies that extracted JSON file content reaches an injected model adapter
through both HTTP hops.

`controlled_corrections.integration.test.js` verifies the AI read-only proposal
handoff to an independent data-service snapshot owner, explicit approval, atomic
application and monotonic-revision rollback. It uses disposable local datasets,
not existing MySQL tables or live deployment configuration.

`docker_build_context.test.js` validates cold boot's archive build path: current
source snapshots, Docker ignore exclusions, binary/long-path tar entries, resolved
Compose image/target/argument settings, development builds and temporary cleanup
on success/failure. It uses temporary fixtures and simulated Docker calls.

`startup_benchmark.test.js` covers Windows bootstrap selection/failure isolation,
automatic entrypoint hooks and process startup markers. The AI repository's
`startup_observer.test.js` covers lifecycle deduplication, restart cancellation,
legacy servers, bounded retries and report-status storage failures.

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
It also checks indexed tile counts, reflected-view deduplication, tile-only
levels and the exact `tile_count - mesh_count` arithmetic used by the UI table.

`mesh_lifecycle.integration.test.js` connects the real store, cache builder,
retrieval and heat-map HTTP handlers on an ephemeral loopback server. It verifies
build/reuse, missing/corrupt retrieval repair, external reconciliation, source
changes, persistent reopen, and rebuild refresh tokens in both `LNN` and
four-character shortcode layouts. A child process is actually killed before
and after durable publication; recovery must neither invent coverage nor lose
a published mesh. `mesh_lifecycle_helpers.js` owns the temporary stores, HTTP
fixture and child-process cleanup. Fault injection touches only these isolated
stores, never the development tile volume.

Run `npm run test:mesh-lifecycle` for the full lifecycle fixture, or
`npm run test:terrain-cache` for all mesh tests. UI lifecycle tests live in
`servers/fracto-ui/test/mesh_heat_map.test.js`; from that repository run
`npm run test:mesh-heat-map`. See `MESH_LIFECYCLE.md` for verification scope.

mesh_transform.test.js covers indexed region selection, mirrored de-duplication, stale counts, durable mesh publication, shared queue cancellation, capacity aborts and decoded source-cache release. Run npm run test:mesh-transform; temporary volume tests require atomic rename support.

mesh_runtime.test.js verifies sufficient-level selection, level-seven fallback, display budgets, mirroring, incomplete coverage, endpoint validation and shared palette histograms. Included in test:terrain-cache; run test:mesh-runtime for focused checks.

terrain_lod.test.js covers complete-quartet availability, independent mirrored refinement, atomic parent fallback, canonical file sharing, coarsening and stable finer-level tone mapping. Included in test:terrain-cache and test:terrain-lod.

`terrain_mesh_cache.test.js` includes a configuration-free handler import test.
It loads the terrain-region handler from an isolated data URL without neighboring
database modules and exercises its injected database functions, preventing an
import-time dependency on the untracked production `config/mysql.json` file.

## WordNet mapping seed

`node --test test/wordnet_mapping_seed.test.js` checks source validation,
factorization, definitions and notes, SQL text encoding, and the exact initial
318-entry migration snapshot. Live database verification also checks every seeded
column against the source and replay behavior using a temporary table.

`node --test test/world_name_suggestions.test.js` verifies full 318-row coverage,
candidate uniqueness, the three-candidate limit, source senses and exact SQL
snapshot reproduction, including that world_name is never assigned.

`world_notes_markdown.test.js` covers formatting-only world-note conversion,
including Unicode, source links, content/order preservation, idempotence and
leaving existing Markdown untouched. Run with
`node --test test/world_notes_markdown.test.js`.

`auth_endpoint.test.js` mounts the data service's actual route declarations in a
VM, supplying real authorization middleware (including the private data editor
and browser notes-origin guards) while replacing database handlers with markers.
Its editor-route regression verifies that ordinary browser sessions, including
administrators, cannot bypass private-service authorization.

`ai_service.integration.test.js` checks the supervised AI listener in a child process, port discovery/overrides, readiness participation and shutdown. It uses no database or model.
It also checks unattended peer identity creation and empty-trust TLS startup on
an isolated port/store. The AI repository peers.test.js exercises real mutual
TLS, scopes, revocation/rotation, bounded automatic probes and privacy separately.
Its exchange.test.js covers automatic completed-job publication, real scoped TLS
imports, authenticated inspection, relay loops, per-record resume, quarantine,
retention/resnapshot, disk/corruption failures and independent local inference.
Its delegation.test.js verifies scoped full-request mTLS execution on one peer,
durable idempotency, lost/post-commit acknowledgements, origin/receiver restart,
no generation retries or fallback, model digest guards, cancellation and revocation.
