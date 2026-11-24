# Fracto tests

`sdk_component_tools.test.js` checks atomic command/history batches, calibrated
references, seeded footprint exclusions, resource allowlists and rejection paths.

`sdk_material_search.test.js` covers explicit unknown placement facts, dimensions/
unit/axis validation, bounded lexical search/filtering/pagination and safe material
projections. Root `npm run test:materials` also runs owning asset/UI tests.

`sdk_component_document.test.js` verifies complete component document roundtrips,
strict bounds/references/allowlists, batch undo/redo, branch invalidation and the
100-edit history bound. `npm run test:components` also runs the owning UI/data
service tests through their declared npm SDK interface and HTTP contracts.

`service_startup_checks.test.js` launches root preflight against isolated service
manifests and real declared checker processes. A failed checker must stop before
database checks; successful and absent optional checks allow preflight to continue.
The database is a stub and no actual services or databases are started.

`migrate_database_bootstrap.test.js` runs the native migration entry point in
isolated temporary checkouts with missing and installed SDK packages. It verifies
actionable dependency recovery, no migration dispatch on failure, and preserved
`--force` arguments. No database connection or real migration is performed.
It also launches a synthetic service that fails before readiness, verifying the
original stderr, exit code and explicit child-exit diagnostic are preserved.

`dependency_boundaries.test.js` checks package-only SDK consumption and rejection
of root/server, server/root, inter-server and SDK/consumer imports, including
re-exports, dynamic imports and requires. Comments and string literals are not
treated as executable dependencies. Integration tests must use HTTP contracts
rather than importing another service's implementation.

Application-specific asset/database suites live in the owning service repositories.
The root retains pure SDK contract tests and generic migration discovery tests.

`update_repositories.test.js` verifies fail-safe divergence handling and the
pre-install deployment inventory. Its integration fixture creates seven isolated
local Git repositories/remotes, then runs the real updater and build-info
generator with runtime `constants.js` present but no SDK or `node_modules`.
It validates complete repository metadata and clean working trees without
contacting real upstreams or changing the developer's checkout. Inventory tests
also reject duplicate/path-escaping names and detect drift from runtime services.

`cold_boot.test.js` checks that a direct, fast-forward-only root pull precedes
the JavaScript updater. Native Windows fixtures use disposable local Git remotes
to update the batch file itself in a path containing spaces, verify exactly one
pull in both `prod` and `dev`, and preserve updater failure codes. A failed root
pull must stop before the updater or image build. Fixtures never start Docker.

`data_query_tiles.test.js` verifies that tile previews/listings use the short-code
primary key, retain bounded results, preserve other tables' ordering, reject
unlisted tables, and report missing live tables without silently using a seed.

`npm run test:tiles-db` verifies the streaming tile database importer: bounded
CSV batches, coordinate/folder conventions, duplicate preservation, transactional
rollback, schema checks, source failures, and restricted LOCAL INFILE streams.
Checkpoint tests cover record-boundary seeking (CRLF, multiline fields and UTF-8),
remote snapshot reuse, and checkpoint failure rollback. The opt-in MySQL tests
also run the CLI across separate processes, test cumulative limits, atomic tile/
checkpoint rollback, concurrent-run rejection, source-change refusal and restart.
Set `FRACTO_TEST_MYSQL_TILE_SEED=1` to include a real MySQL integration test using
the data service’s private configuration and host/port overrides. It tests the automatically
selected bulk method, needs schema create/drop privileges, and touches only its
disposable schema.

`docker_build_context.test.js` verifies the deployed source context excludes
credentials and private runtime state while retaining reviewed source inputs.
The local `test/test.json` peer-configuration scratch file is excluded by both
Git and Docker ignore rules; it is not a test fixture and must stay local.

`free_ec2_port_3007.test.js` uses mocked Linux commands and temporary nginx files
to verify inspection, backup/edit/reload, invalid-edit rollback, and refusal to
touch non-nginx listeners. It runs as root on Linux; no real service is touched.

`database_migration_compatibility.test.js` checks immutable migration SQL handling.
For a real MySQL check, run
`FRACTO_TEST_MYSQL_MIGRATIONS=1 node --test test/database_migration_compatibility.integration.test.js`.
It creates and removes only its own disposable schema, exercising migration 006
under general and Unicode collation defaults, note preservation and safe retries.
It also checks migration 011's Unicode 5.2 fallback, replay safety, and preservation
of existing video rows when MySQL 8 collations are unavailable.
The database configuration is read only after the opt-in test is enabled, so
ordinary builds can skip it without a private `config/mysql.json` file.

`servers/fracto-ai-server/knowledge_bundle.test.js` covers deterministic artifacts,
source/provenance changes, invalid manifests, bounded source reads, path/link
rejection, scoped Git metadata, check-only behavior and atomic publication failure.
`servers/fracto-ui/test/knowledge_documents.test.js` covers complete area rendering,
feature states/configuration, determinism, cancellation and inert Markdown text.
Run both with `npm run test:knowledge-bundle`; neither uses models or live stores.

`npm run test:knowledge-reconcile` runs the AI bundle persistence tests in
disposable stores: atomic import/rollback, immutable history, unchanged replay,
provider ownership, local overrides, removal/restoration, source collisions,
schema migration, disk/capacity admission and generated-bundle CLI adoption.
It does not modify a running deployment or activate skills.

`npm run test:knowledge-publication` verifies complete immutable snapshot selection,
reader pinning across writers, publication races, overrides/retirement, unchanged
database bytes/timestamps, late import/publication failures, corruption, migration
and generated-artifact CLI publication in disposable storage.

`npm run test:app-reference` verifies the read-only application skill's exact
snapshot citations, concurrent publication pinning, unavailable/disabled data,
strict schemas/permissions, inert reference instructions, isolated evaluations,
bootstrap persistence and real UI bundle retrieval through the registry CLI.

`npm run test:chat-reference` checks the App reference mode through browser
streaming, the administrator bridge, the AI service and active skill in disposable
stores, including exact citations, no model/database writes, strict routing,
unavailable references, literal Markdown, cancellation and bounded concurrency.

`npm run check:app-reference` is the full cross-repository regression gate: fresh
bundle generation, canonical unchanged verification and provider/catalog/storage/
publication/refresh/skill/chat tests in disposable stores. Main/AI/UI CI prepare
the full sibling workspace and dependencies before running it.
`npm run test:knowledge-refresh` focuses on automatic startup/periodic updates,
restart, failure atomicity/recovery, local overrides, operator handoff, retention
bounds, configuration, shutdown and serialized development rebuilds.

`servers/fracto-ui/test/feature_catalog.test.js` validates the structured UI
catalog, exact navigation/title/settings coverage, permission/configuration
references, incomplete panel states and the inactive UI subject-provider
declaration. In-memory source edits verify drift detection without executing JSX
or mutating the checkout. UI npm builds also run the catalog source check.

`servers/fracto-ai-server/test/chat_stream.test.js` covers incremental UTF-8/NDJSON framing, completion/error
semantics, size limits, backpressure, browser accumulation, and streaming through
both HTTP hops. Delayed fixtures verify first text arrives before completion;
Stop and timeouts abort model work. Engine tests also cover Ollama streaming and
provider metadata filtering. No real model or machine credential is required.

`servers/fracto-admin-server/test/admin_chat.test.js` verifies the admin chat bridge's origin/session enforcement,
bounded text contract, server-only credentials, response filtering, fixed errors
and timeout cancellation using local HTTP fixtures. It requires no running AI
engine, model, database or real machine token.

`servers/fracto-ui/test/admin_chat_messages.test.js` covers text-file extraction,
UTF-8/JSON validation, file size/count bounds, local attachment lifecycle,
file-only messages and combined/escaped context limits. The admin bridge test
also verifies that extracted JSON file content reaches an injected model adapter
through both HTTP hops.

`servers/fracto-ai-server/test/controlled_corrections.integration.test.js` verifies the AI read-only proposal
handoff to an independent data-service snapshot owner, explicit approval, atomic
application and monotonic-revision rollback. It uses disposable local datasets,
not existing MySQL tables or live deployment configuration.

`docker_build_context.test.js` validates cold boot's archive build path: current
source snapshots, Docker ignore exclusions, binary/long-path tar entries, resolved
Compose image/target/argument settings, development builds and temporary cleanup
on success/failure. It uses temporary fixtures and simulated Docker calls.
Managed image-retention checks cover unchanged immutable identities, missing
images and renamed retained containers; name mismatches must fail before any
image tag or build is changed.

`managed_recovery.test.js` reproduces the stopped rollback container, failed
candidate and older failed-name occupant that caused Docker 409 on the lab.
It verifies journal-backed retention, controller rollback, identity checks,
retry/idempotence, proactive name reservation, concurrent metadata changes and
refusal of unknown/running containers. Fixtures never invoke real Docker.
`managed_mounts.test.js` covers Docker Desktop path mapping and missing config
binds, preservation of existing volumes/options, conflicting targets and the
guarded controller adapter with a retained source backup. It executes the adapted
fixture and checks that AI-only rehearsal mounts stay isolated.
`cold_boot_preflight.test.js` verifies service-owned configuration failures and
missing directories stop before recovery/build/stop, with repeatable managed
contract generation. These suites run in the root test command. Windows batch
fixtures additionally verify preflight order and failure propagation.

`startup_benchmark.test.js` covers Windows bootstrap selection/failure isolation,
automatic entrypoint hooks and process startup markers. The AI repository's
`startup_observer.test.js` covers lifecycle deduplication, restart cancellation,
legacy servers, bounded retries and report-status storage failures.

Root tests use Node's built-in test runner and cover SDK, service, script and
integration behavior. Run the maintained suite with `npm test`; run a focused
file with `node --test test/<file>.test.js`.

`servers/fracto-tiles-server/test/terrain_mesh_cache.test.js` covers native-level planning from saved bailiwick
regions, normalized mesh geometry, binary round trips, cache reuse, corrupt
cache recovery, partial coverage and queued-job API behavior. It uses synthetic
numerical tiles and temporary directories; it does not require a running DB or
tile service. Live cache jobs can be started from the freeform page's test button.

`servers/fracto-tiles-server/test/mesh_storage.test.js` covers active-volume path selection, both tile-compatible
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

`servers/fracto-tiles-server/test/mesh_inventory_store.test.js` verifies cold indexing, warm startup without mesh
decoding, source changes, uncheckpointed replay, interrupted file publication,
torn/corrupt metadata recovery, compaction ordering, external additions/deletions,
corrupt-file invalidation, active-worker reconciliation, cache hooks, retrieval
repair, worker acknowledgments and failure recovery. Tests use temporary stores
and synthetic numerical data; no live services are required.

`servers/fracto-tiles-server/test/mesh_heat_map.test.js` covers ready-only availability, empty regions, overlap
precedence, mirrored/real-axis coverage, rectangular views, level 34, subpixel
meshes, boundary rounding, request limits, bounded inventory collection, and
sanitized endpoint failures. Raster results are checked against a direct
pixel-center reference. Run it with `npm run test:mesh-heat-map`.
It also checks indexed tile counts, reflected-view deduplication, tile-only
levels and the exact `tile_count - mesh_count` arithmetic used by the UI table.

`servers/fracto-tiles-server/test/mesh_lifecycle.integration.test.js` connects the real store, cache builder,
retrieval and heat-map HTTP handlers on an ephemeral loopback server. It verifies
build/reuse, missing/corrupt retrieval repair, external reconciliation, source
changes, persistent reopen, and rebuild refresh tokens in both `LNN` and
four-character shortcode layouts. A child process is actually killed before
and after durable publication; recovery must neither invent coverage nor lose
a published mesh. `servers/fracto-tiles-server/test/mesh_lifecycle_helpers.js` owns the temporary stores, HTTP
fixture and child-process cleanup. Fault injection touches only these isolated
stores, never the development tile volume.

Run `npm run test:mesh-lifecycle` for the full lifecycle fixture, or
`npm run test:terrain-cache` for all mesh tests. UI lifecycle tests live in
`servers/fracto-ui/test/mesh_heat_map.test.js`; from that repository run
`npm run test:mesh-heat-map`. See `MESH_LIFECYCLE.md` for verification scope.

mesh_transform.test.js covers indexed region selection, mirrored de-duplication, stale counts, durable mesh publication, shared queue cancellation, capacity aborts and decoded source-cache release. Run npm run test:mesh-transform; temporary volume tests require atomic rename support.

mesh_runtime.test.js verifies sufficient-level selection, level-seven fallback, display budgets, mirroring, incomplete coverage, endpoint validation and shared palette histograms. Included in test:terrain-cache; run test:mesh-runtime for focused checks.

terrain_lod.test.js covers complete-quartet availability, independent mirrored refinement, atomic parent fallback, canonical file sharing, coarsening and stable finer-level tone mapping. Included in test:terrain-cache and test:terrain-lod.

`servers/fracto-tiles-server/test/terrain_mesh_cache.test.js` includes a configuration-free handler import test.
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

`ai_service.integration.test.js` verifies the real AI launcher, health contract and
peer exchange/delegation readiness on temporary ports and storage. HTTP startup
and peer startup each have a separate 60-second budget for cold parallel builds,
with bounded HTTP requests. Missing `.env` is allowed; no engine/model is needed.

wsl_relay_repair.test.js runs the actual PowerShell repair logic with isolated
listener/process/HTTP providers and a recording stop function. Tests never stop
real processes or change networking. Windows cases cover prod/dev stale relays,
healthy relays, unrelated/shared processes, identity and listener races, unavailable
IPv4 and failure to recover localhost. A portable check verifies both cold-boot paths.

`cold_boot_migrations.test.js` executes the Windows batch flow against disposable
command fixtures for production, development and managed production. It verifies
build/stop/migrate/start ordering, optional index refresh, and fail-closed migration,
stop and build errors with preserved exit codes. It never starts real Docker or
changes a database. Migration runner tests cover applied checksums and no-op runs.

The SDK catalog tests validate model/folder management shapes, revision/name bounds
and exact folder ancestry alongside archive registration compatibility.

The cold-boot Compose fixture rejects unsupported run --no-build flags and tests
that rejection. It also verifies the migration service references the existing
image without declaring a build target.

`npm run test:construction-planner` runs AI-owned synthetic planner/HTTP tests
alongside shared component document/tool contracts. It covers bounded model
schemas, catalog projection/revision checks, SDK replay, missing calibration,
invalid aliases/geometry, no persistent writes, admission and cancellation.
It also runs the AI browser authorization/disconnect tests and UI-owned proposal,
hook lifecycle, proxy and atomic history tests for step 5.
Step 6 adds SDK matching/projection bounds, AppSettings reload/edit/delete and
rollback, explicit memory controls and stale-memory request/proposal invalidation.
Real-model verification is the AI service's separate `construction:plan --smoke`
CLI; no model is required by automated tests.

`npm run test:construction-evaluation` runs representative scoring, renderer/history
and draft-failure checks, plus persistence tests with opt-in temporary-table SQL.
The AI-owned `construction:evaluate` CLI separates offline scripted outcomes from
live catalog/model evidence. See its construction/EVALUATION.md acceptance report.
The suite also verifies asset-owned surface extraction and normalized runtime
publication. Opt-in actual catalog geometry checks live in the UI service's
`test/live_material_calibration.test.js`; they include ground anchors, leaf
cutouts and the registered `dry_dirt` image and write only a diagnostic report.
The AI-owned `construction/wooded_path.test.js` verifies reviewed composition
across counts, dimensions, seeds, corridor axes/offsets, broad calibrated canopies,
explicit scale conflicts, stale pins, JSON regeneration and atomic undo/redo.

`coverage_lazy_index.test.js` verifies that coverage initialization counts the
compiled index without retaining duplicate shortcode Sets, and that the first
coverage query, cached reuse and index reset preserve membership results. It uses
an isolated tiny index and local classification fixtures, without the live stack.

The SDK component tools tests also exercise bounded `place-pattern` expansion,
exact instance shapes, missing pins, duplicate IDs and atomic count rejection.
The AI's `construction/dense_grass_strip.test.js` checks transform fidelity to
the reviewed 809-patch recipe, sampled coverage, scale/pin guards and replay.

The component document tests cover optional persisted `animation_speed`, finite
0–10 validation, quarter-speed JSON roundtrips, unchanged legacy canonical bytes
and authored-speed undo/redo.

`sdk_component_motion.test.js` verifies the optional facing-patrol contract,
deterministic speed/distance sampling, forward-facing return legs, JSON/history
retention and invalid-field rejection.
