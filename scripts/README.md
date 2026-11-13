# Fracto scripts

`verify_catalog_confirmation.js [--full]` checks the ten previously unresolved
confirmation-depth families, or all 412 bundled families with `--full`, using
catalog-only discovery and compact assignment validation. Every published angle
must match its analytic unit-circle point within 1e-12; no sibling rays, full
paths or database writes are allowed. It records per-family precision, depth,
retry counts, sample statistics and result size. Evidence is saved to
`logs/catalog_confirmation_repair_verification.json` or
`logs/catalog_confirmation_full_verification.json`. The full repaired run verified
all 412 families and 13,231 ratios with no unresolved cases. Timings are diagnostic
observations rather than an isolated performance benchmark.

`benchmark_catalog_only_jobs.js [--max-denominator 31] [--case all|unit_circle|basilica|stored_core]
[--source-id 65] [--reference full|none] [--output logs/catalog_only_jobs_benchmark.json]`
benchmarks the current catalog-only coordinator. It reads application focal
points but performs all writes in a uniquely owned disposable database. Each
cold job cancels after two committed families and resumes with a new coordinator;
every family must run once. A fresh warm job must use zero solver tasks and
preserve membership, verified ratios, unresolved counts and denominator coverage.
Discovery must leave path storage empty. Selecting the orbital containing `1/7`
(or another verified orbital) then times path generation, persistence and cache
reload; only that orbital may acquire geometry.

The full reference traces all families and independently compares every shared
ratio's target and orbital cycle. Differences in numerical resolution are recorded
explicitly, not counted as parity. Profiles, environment, cold/resumed/warm times,
compact result bytes, coverage and selection times are saved in the JSON report.
These are single observations: cold includes worker/SQL overhead, warm includes
evidence rechecking and SQL publication, and selection excludes browser transfer
and canvas painting. No interval certificate or exhaustive-discovery claim is made.

For a full bundled-catalog durability run, use `--max-denominator 255 --case
unit_circle --reference none --output logs/catalog_only_full_catalog_benchmark.json`.
This investigates all 412 families, then verifies cached reuse. The general
benchmark and numerical reference should run sequentially to avoid CPU contention.

`FRACTO_DB_INTEGRATION=1 FRACTO_RAY_BENCHMARK_OUTPUT=logs/selected_catalog_path_benchmark.json
node --test test/orbital_selected_paths.integration.test.js` records a separate
162-ray selection benchmark. It uses connection-local temporary tables and
measures tracing, saving, and reading/decompressing/validating the full geometry.
Without the output variable this remains the usual database regression test.

`benchmark_representative_orbitals.js [--full-reference] [--assignments]` is a read-only numerical
benchmark of the adaptive single-ray solver on a unit-circle family, a basilica
divisor family, period 58, and the former 162-ray blocker. No database is used.
`--full-reference` additionally computes full family paths and checks the same
candidate orbit/representative target. The new solver leaves ratio associations
pending, so its timings measure less work than complete path validation. Profiles,
timings, sample counts and serialized result sizes are saved to
`logs/representative_orbital_benchmark.json`.

`--assignments` also runs independent compact landing validation, recording its
time, result size, trace/transport counters and verified ratio count. Combined
with `--full-reference`, it checks every angle's target against full-family
tracing. This mode writes `logs/landing_assignment_benchmark.json`; it does not
change application data or populate caches.

`verify_orbital_catalog_recovery.js RUN_ID [WORKER_FIXTURE.gz]` reads a stopped
catalog checkpoint and clones its cursor/settings into a disposable schema.
It verifies that two more families commit, the cursor advances, large geometry
uses bounded chunks, and all rays reload through the Julia cache store. Original
application rows are read only. The optional gzip fixture contains a previously
traced `{context,result}` for the blocked family; otherwise the real worker
calculates it. Evidence is saved to `logs/orbital_catalog_recovery_verification.json`.
This diagnostic requires the project's MySQL configuration, schema-creation
privileges and migrations through 015 available to its disposable setup.

`benchmark_orbital_catalog.js [--max-denominator 31] [--grid-size 31]
[--source-id 65] [--output logs/orbital_catalog_benchmark.json]` verifies and times
the complete persisted catalog workflow for c=0, c=-1, and one stored core point.
The selected application source is read only. All survey jobs, orbitals, leases,
paths and cancellation/resume operations use a unique disposable MySQL schema,
which is removed in cleanup. It requires database schema-creation privileges.

Each cold job is canceled after two committed families and resumed by a new
coordinator. Every family must be computed exactly once. A fresh warm job must
use only cached family outcomes, preserve ranked orbital membership and counts,
and return identical saved coverage. An uninterrupted SDK calculation supplies
a reference for candidate cycles and validated/unresolved families. Stored
landing families are independently revalidated. Reports include profile, CPU,
Node version, timings, worker-task counts, coverage and compressed path storage.
These are single development-machine observations; cold includes worker startup
and resume overhead, and warm still performs the survey and SQL publication.
The diagnostic grid/bound are explicit and do not establish completeness.

`FRACTO_DB_INTEGRATION=1 npm run test:orbital-catalog-jobs` also exercises an
actual process killed after committing a family outcome, along with owner
replacement, stale-token fencing, path publication and coverage reload.

`benchmark_orbital_catalog.js [--max-denominator 31] [--grid-size 31]
[--source-id 65] [--output logs/orbital_catalog_benchmark.json]` verifies and times
the complete persisted catalog workflow for c=0, c=-1, and one stored core point.
The selected application source is read only. All survey jobs, orbitals, leases,
paths and cancellation/resume operations use a unique disposable MySQL schema,
which is removed in cleanup. It requires database schema-creation privileges.

Each cold job is canceled after two committed families and resumed by a new
coordinator. Every family must be computed exactly once. A fresh warm job must
use only cached family outcomes, preserve ranked orbital membership and counts,
and return identical saved coverage. An uninterrupted SDK calculation supplies
a reference for candidate cycles and validated/unresolved families. Stored
landing families are independently revalidated. Reports include profile, CPU,
Node version, timings, worker-task counts, coverage and compressed path storage.
These are single development-machine observations; cold includes worker startup
and resume overhead, and warm still performs the survey and SQL publication.
The diagnostic grid/bound are explicit and do not establish completeness.

`FRACTO_DB_INTEGRATION=1 npm run test:orbital-catalog-jobs` also exercises an
actual process killed after committing a family outcome, along with owner
replacement, stale-token fencing, path publication and coverage reload.

`build_database_orbital_catalog.js [--max-denominator N] [--numerator-limit 256] [--max-angle-period 32]
[--out FILE] [--export-only]` incrementally populates the complete database angle
catalog, then exports its small-numerator families into the SDK. Apply migration
017 first with `node scripts/initialize_database.js`. Run:

```sh
node scripts/build_database_orbital_catalog.js --max-denominator 32767
node scripts/build_database_orbital_catalog.js --max-denominator 65535
node scripts/build_database_orbital_catalog.js --max-denominator 131071
node scripts/build_database_orbital_catalog.js --max-denominator 524287
```

The default bound is 524287. Every odd denominator is calculated, including all
families regardless of numerator. Transactions commit one complete denominator
at a time; interrupted builds resume by skipping committed denominators. A named
database lock prevents concurrent builders. There is no full-catalog angle array
or million-angle allocation budget in this route; generation uses one denominator
at a time, and total computation still grows roughly quadratically with the bound.

The default export is `sdk/orbitals/data/denominator-catalog-small-numerators.json`.
It selects canonical numerators strictly below 256 and angle periods at most 32
from the database, preserving complete cycles implicitly in the compact v2 SDK
format. The period limit affects only the export; the database retains all angle
periods and numerators. `--max-angle-period N` changes the export's inclusive
period ceiling. Ineligible denominator entries are omitted from JSON, and
`max_angle_period` records this scope for SDK validation. `--export-only` performs
no catalog writes. Exports use a consistent database snapshot, check coverage and
family counts, validate exact families, and atomically replace the output file.
The original `denominator-catalog.json` is preserved for historical checkpoints.
New data-service jobs use the filtered export by default, with a denominator
bound of 524287 and family budget of 65536. `FRACTO_ORBITAL_CATALOG_FILE` can
override the file before service startup. After updating a running service,
restart it and select Rediscover to start with the expanded catalog; resuming
an existing job retains its saved catalog and work budgets. Family descriptors stay compact
until the current family is processed.

`build_orbital_denominator_catalog.js [--max-denominator N] [--out FILE]
[--angle-budget N] [--check]` builds the periodic ray-family preprocessing catalog.
Its default output is `sdk/orbitals/data/denominator-catalog.json`, initially
covering denominators through 255. Increasing the bound validates and retains
all prior entries, then adds only new denominators. `--check` verifies an existing
file without writing it. With no bound argument an existing larger catalog is
preserved. Invalid existing files and explicit shrink requests fail without
replacing the file; successful writes use a temporary file and atomic rename.
See [the catalog format and API](../sdk/orbitals/README.md#denominator-based-preprocessing-catalog).

`free_ec2_port_3007.sh --inspect` identifies an nginx listener that conflicts with
the AI container and lists the loaded configuration files containing `listen
3007`. Run with `sudo`. `--edit` lets the operator select a file, backs it up
under `/var/backups/fracto-nginx`, and opens `${EDITOR:-vi}` for review. Remove
the dedicated legacy server block, or only its 3007 listener when other ports
share the block. It tests the configuration before gracefully reloading nginx,
restores the original file if editing/validation/reload fails, and verifies that
the IPv4 loopback port is free. It never stops/disables nginx or removes public
proxy routes automatically. `FRACTO_NGINX_BACKUP_DIR` can select another backup
directory outside nginx's include trees.

`validate_ec2_deployment.js` checks the host tile root's `meshes` bind directory
before the deployment workflow stops production. Create that directory for the
container's UID/GID 1000 first; see `deploy/README.md`. Validation does not create
directories or change numerical tile permissions.

`initialize_database.js` uses `database_migration_compatibility.js` to prepare
the execution copy of migration 006's marker comparison with explicit Unicode
collation. Its immutable SQL file and recorded checksum remain unchanged.
This permits a normal migration retry on servers whose generated UTF-8
expressions otherwise default to `utf8mb4_general_ci`.
Both backup loading and pending migration execution use the detected server
collation support: unsupported `utf8mb4_0900_ai_ci` is mapped to the existing
`utf8mb4_unicode_520_ci` fallback in the execution copy. Original SQL files and
their checksums remain unchanged; successful migrations are not replayed.

## Single-core orbital verification

After migration 007 is applied, the explicit application-data command
`node scripts/verify_application_orbitals.js 55` starts/reuses one discovery job
through the running data server using its existing service authorization. It
retains the discovered records in the configured application database and
checks closure, landing families, API/direct database retrieval, idempotency,
and source-row preservation. It performs no backfill or destructive SQL and
writes `logs/application_orbital_verification.json`. Repeating this command
reuses its fixed request key for that source and settings. The command does not
apply migrations itself.

`node scripts/verify_orbital_discovery.js 55` reads that freeform bailiwick's
`core_point`, applies migrations 007 and 008 to a newly created disposable MySQL schema,
and runs actual SDK workers through the HTTP discovery/storage/read cycle.
It checks rollback, retry conflicts, deduplication, cancellation, leases, and
retrieval across a service-process restart. It drops only its generated test
schema and writes `logs/orbital_discovery_verification.json`. The source and
application schema are unchanged; no backfill runs. See
`servers/fracto-data-server/ORBITAL_DATA.md` for permissions and container usage.

## Knowledge bundle preparation

`build_knowledge_bundle.js` runs source drift checks, reads the approved UI catalog
and generates seven area documents with a deterministic manifest. Run
`npm run knowledge:bundle` to generate the ignored AI build artifact or
`npm run knowledge:bundle:check` to verify it without writing. UI npm prebuild and
Docker preparation invoke generation automatically. No knowledge database,
selection, skill activation, model or peer is touched. See
`servers/fracto-ai-server/subject_providers/BUNDLES.md` for schema and provenance.

`npm run knowledge:reconcile` explicitly imports the generated UI bundle into the
configured AI knowledge store atomically, preserving operator overrides and
retirements. `npm run knowledge:bundle:status` reads its selected manifest. These
are local administration commands, separate from build preparation and skill
activation. See `servers/fracto-ai-server/subject_providers/RECONCILIATION.md`.

After staging, `npm run knowledge:bundle:publish -- DIGEST EXPECTED_DIGEST` selects
a complete snapshot (`none` for the first expectation).
`knowledge:bundle:publication` inspects its metadata; `knowledge:bundle:read`
returns its whole artifact. Publication is local and leaves skill/chat activation
separate. See `servers/fracto-ai-server/subject_providers/SNAPSHOTS.md`.

AI startup and a minute poll now automatically consume prepared bundles, with
atomic publication and persistent operator ownership. Vite development also
rebuilds on relevant UI/catalog changes. `FRACTO_AI_APP_REFERENCE_REFRESH=false`
keeps manual control. `npm run check:app-reference` generates/checks the artifact
and runs the complete catalog-to-chat regression gate used by main/AI/UI CI.
See `servers/fracto-ai-server/subject_providers/REFRESH.md` for lifecycle and handoff.

`windows_host_startup.js` is the standard launcher bridge for Windows host
facilities: automatic startup benchmarks and the independent local Ollama engine.
Both skip Windows setup inside Linux containers. Ollama installation/startup is
asynchronous and does not change Fracto readiness; its version and loopback-only
runtime configuration are documented in `servers/fracto-ai-server/OLLAMA.md`.

`startup_benchmark.js` launches the Windows host observer through
`start_windows_benchmark.ps1`. Production/development launchers, first-run,
cold-boot invoke it through `windows_host_startup.js`; native root startup invokes
the helper directly. Its hidden worker
is deduplicated per checkout/port, collects an inventory for each new Fracto
startup, waits for stable readiness and then records a passive baseline.
It never blocks readiness or installs a Windows boot task. Reports and policy
are documented in `servers/fracto-ai-server/BENCHMARKS.md`.

These scripts are grouped by the work they perform rather than by file type.
Run commands from the repository root. Files under `config/`, `backup/`,
`tiles/`, `logs/`, and each service repository retain their existing ownership
and persistence rules.

## Normal workflow

`npm run meshes:init` prepares and probes the mesh subtree on the active tile
volume. `initialize_mesh_storage.js --tiles-directory PATH --layout level`
prepares a local-source host directory before its nested writable Docker mount
is created. See `sdk/terrain/README.md` for the two layouts and permissions.

For a normal local launch:

```powershell
npm run tiles:index
npm run start:check
npm run check
npm start
```

`npm start` runs `update:repos` through the `prestart` hook. Tile-index building,
database initialization, and Docker maintenance are explicit operations because
they can be long-running or change persistent data.

The root supervisor opens the main server, starts admin for runtime port
discovery, starts tiles, then starts data, asset, UI and AI sequentially. It waits for health endpoints before continuing.
See the root README for Docker production/development and first-run workflows.

## Admin page scaffolding contract

The initial page generator is scoped to the admin section. Common inputs are
the target section, unique page identifier, sidebar label, page title, and
scaffold type. The command contract is:

```powershell
npm run page:add -- --section admin --name <page-name> `
  --sidebar-label "<sidebar-label>" --title "<page-title>" `
  --scaffold title-only [--dry-run | --apply]
```

For example, `npm run page:add -- --section admin --name servers
--sidebar-label servers --title "server awareness" --scaffold title-only`
previews the admin page scaffold for the `servers` sidebar item. `<page-name>`
is a lowercase kebab-case identifier used to derive the section code,
component name, and text key. The sidebar label and page title are separate
user-visible values so they can differ. `title-only` renders only the
registered page title. `documentation` renders a left tree panel and a right
Markdown panel, with empty tree and Markdown data until a source is defined.

All five fields above belong to the shared page request. The initial admin
request has no additional section-specific options. Future section
configurations may define their own options—for example, study-specific
layout or subsection inputs—without changing these shared fields or the
command's common workflow. Those future options must remain distinct from the
shared request rather than being inferred from admin arguments.

The generated change is limited to the UI admin feature: a page component under
`servers/fracto-ui/src/pages/admin/`, the admin section constant in
`src/settings/AdminSettings.jsx`, the sidebar label and page title in
`src/text/AdminText.jsx`, its sidebar registration in `src/pages/Admin.jsx`,
and the admin-pages README. Both templates render the registered page title
using the existing `MainStyles.SectionTitle` and `AppText` patterns. The
documentation scaffold uses the shared Markdown renderer and tree control; its
tree and Markdown lookup are empty until a content source is defined. Neither
template adds page-specific settings, backend behavior, navigation outside the
admin section, or application routes.

The command previews each proposed file creation and registry or README
addition without modifying files by default. Add `--dry-run` to make that
no-write behavior explicit, or add `--apply` to install the preview after all
checks pass. The apply path stages all five outputs and keeps temporary backups
until installation succeeds. Before showing a preview it rejects malformed or
unknown options, invalid names, existing generated files or identifiers, and
missing admin source files or expected insertion anchors. If the source layout
has changed, it stops and reports the affected file and anchor. Other
sections, including study, are outside this contract and can define additional
inputs through section-specific configuration in a later step. Run
`npm run test:page-scaffold` to test the generator against temporary fixtures.

## Social media synchronization

### `sync_bluesky_media.js`

Fetches the public author feed for `fracto-studio.bsky.social` once, then
updates both the public post archive (`social/Bluesky/POST_ARCHIVE.md`) and the
image/video media ledger (`social/Bluesky/media/MEDIA_UPLOADS.md`). Entries
remain newest-first and are deduplicated by post CID (and by blob CID for
media). The script never downloads the media files themselves. Use
`npm run social:sync` directly. Launch workflows do not contact Bluesky; the
admin social endpoint refreshes stale snapshots on demand.
The Admin Social page can force an immediate refresh with its refresh action;
the equivalent endpoint request is `/social?refresh=true`.
The root test suite validates the freshness contract without contacting Bluesky.
The development container mounts `social/` writable so a successful refresh
can publish updated snapshots. Its temporary concurrency lock is stored under
`logs/`, which is runtime storage rather than part of the social source tree.
A successful refresh updates both snapshot timestamps even when the feed has no
new entries, so the Admin page reports the last successful check rather than the
last content change.

Set `FRACTO_SOCIAL_SYNC_TTL_MS` in the root `.env` to change the freshness
interval; the default is 24 hours (`86400000` milliseconds).

The actor, feed limit, and page count can be overridden with
`FRACTO_BLUESKY_ACTOR`, `FRACTO_BLUESKY_POST_LIMIT`, and
`FRACTO_BLUESKY_MAX_PAGES`, or with the corresponding `--actor`, `--limit`, and
`--pages` options. Add `--allow-failure` for a best-effort refresh. Manual
`npm run social:sync` calls remain strict by default. A short-lived lock prevents concurrent sync processes
from rewriting the ledger at the same time; a stale lock should be removed only
after confirming that no sync process is still running.

## Spectral analysis benchmark

`npm run data:spectral:benchmark` compares the established single spectral
analysis pass with the eighteen-pass multi-configuration analysis using one shared
synthetic orbit sample set. It reports min/average/max timings and the measured
multi-pass relative cost. The benchmark isolates analysis cost from orbit discovery,
network requests, and UI rendering.

## Tile rendering benchmarks

### `benchmark_canvas_render.js`

Runs independent renderer suites against a running tiles service. With no
strategy argument, `npm run tiles:benchmark` runs both suites; use
`npm run tiles:benchmark:legacy` or `npm run tiles:benchmark:turbo` for one
suite. Each run samples bailiwick fixtures,
warms the selected strategy, records repeated timings, and writes a dated JSON
report under `servers/fracto-tiles-server/benchmarks/legacy/` or `turbo/`.
Reports are runtime data and are ignored by Git.

### `benchmark_heat_map.js`

`npm run tiles:benchmark:heat-map` measures the tile service's
`/heat_map_buffer` endpoint using the same fixture selection used by the canvas
benchmarks. It combines free, inline, and nodal `free_bailiwicks` records,
sorts them by descending magnitude, and randomly samples records from the
inclusive 500–1000 range by default. Each selected record contributes one
fixture for each requested square width (256, 512, and 1024 pixels by
default), using the focal point and scope stored in its display settings.
Each fixture is warmed once and then measured repeatedly; reports contain the
response dimensions, coverage level count, every sample, and min/median/max
timings. Reports are written to the Git-ignored
`servers/fracto-tiles-server/benchmarks/heat-map/` directory.

The script accepts `--tiles-url`, `--data-url`, `--sample-count`,
`--start-index`, `--end-index`, `--repetitions`, `--widths`, and `--output`.
The corresponding `FRACTO_TILES_URL`, `FRACTO_DATA_URL`,
`FRACTO_HEAT_MAP_SAMPLE_COUNT`, `FRACTO_HEAT_MAP_START_INDEX`,
`FRACTO_HEAT_MAP_END_INDEX`, and `FRACTO_HEAT_MAP_REPETITIONS` environment
variables provide defaults.

## Orbital circuitry sampling

### `circuitry_harness.js`

Calls the data server's `/circuitry` endpoint for one or more Mandelbrot
parameter pairs and writes the sampled curves to a timestamped JSON report.
Start the data server first, then run for example:

```powershell
npm run data:circuitry -- --pairs "-1,0;0.25,0" --samples 512
```

The harness also accepts `--url`, `--limit`, `--samples`, and `--output`.
Without `--output`, reports are written under
`servers/fracto-data-server/benchmarks/circuitry/`, which is runtime data and
ignored by Git. `FRACTO_DATA_URL`, `FRACTO_CIRCUITRY_LIMIT`, and
`FRACTO_CIRCUITRY_SAMPLES` provide environment defaults.

### `orbital_newton_harness.js`

Calls `/orbital_newton` to test the return-based cardinality detector and pass
the result into native and/or BigComplex Newton refinement. For example:

```powershell
npm run data:orbital:newton -- --pairs "0.1517440416,0.5760073226" --mode both
```

Use `--iterations`, `--repetitions`, `--newton-limit`, `--mode`, `--url`, and
`--output` to control the run. Reports are written under
`servers/fracto-data-server/benchmarks/orbital-newton/`, which is runtime data
and ignored by Git.

### `benchmark_orbital_newton.js`

`npm run data:orbital:newton:benchmark` compares known-cardinality Newton
execution with the legacy cardinality-search loop for native and BigComplex
solvers. It uses the cardinality-7 and cardinality-65 reference fixtures and
reports min/average/max timings plus the speedup from avoiding the outer `N`
search. This benchmark measures solver cost only; return detection is not
included. The BigComplex legacy search is intentionally skipped by default
because it scans thousands of cardinalities; enable it explicitly with
`FRACTO_INCLUDE_BIG_NEWTON_LEGACY=true`.

### `benchmark_orbital_detector.js`

`npm run data:orbital:detector:benchmark` randomly samples usable core points
from the `free_bailiwicks` table through `/minibrots`, then tests each record's
stored `core_point` with the return-based cardinality detector at
`/orbital_spectrum`. Display settings are never used for detector coordinates;
records without a valid core point are excluded. The report
keeps the table's `pattern` as the expected cardinality, the detector result,
status, elapsed time, category, and summary accuracy. It does not run Newton
refinement, so detector quality and detector cost are measured independently.
An `unexpected_response_shape` result indicates that the running data server
does not expose the current detector response (usually an older container that
needs rebuilding); it is reported separately from a genuine inconclusive result.

Use `--sample-count`, `--pool-limit`, `--iterations`, `--repetitions`, `--url`,
and `--output`; defaults are 100 samples, up to 5,000 records per category,
4,096 iterations, and five matching returns. Reports are written under
`servers/fracto-data-server/benchmarks/orbital-detector/` and are ignored by
Git. The data server caps a requested minibrot pool at 20,000 records per
category.

## Repository and startup orchestration

### `update_repositories.js`

Fetches and fast-forwards the root and six service repositories:

```powershell
npm run update:repos
```

It aborts for tracked/staged changes, detached heads, missing upstreams,
divergent branches, or network/Git failures. It preserves untracked runtime
files and never installs packages, rebases, resets, or creates merge commits.
Fetch and fast-forward merge commands inherit the console output, so the full
Git progress and summary are visible just as they are at the command line. Git
color is forced for these visible operations, including colored additions and
deletions where Git emits them.
The one permitted unstaged exception is the tracked IDE metadata file
`.idea/fracto.iml`; this avoids blocking cold boot on local IntelliJ folder
exclusions. All other tracked or staged changes still abort the update.

The standalone `npm run update:repos` command remains fail-safe and never resets
diverged history. `cold_boot.bat` opts into an interactive recovery prompt: when
divergence is found, it lists each affected repository and its local/upstream
revision, then requires the exact text `RESET`. Confirmation hard-resets only
those diverged repositories to their configured upstream. Declining or running
without an interactive terminal leaves branch refs unchanged and aborts. Tracked
or staged changes normally abort before the prompt (the existing `.idea/fracto.iml`
exception still applies); untracked files are preserved by the reset.

### `startup_preflight.js`

Checks service package files, ports, entry points, dependencies, and the MySQL
connection (`SELECT 1`) without opening service ports. In local tile-source
mode it also checks that the mounted corpus is readable/searchable, verifies
the `LNN` layout and paired compiled-index metadata, and decodes an indexed
representative tile before the root supervisor opens any listener:

```powershell
npm run start:check
```

It honors `FRACTO_MYSQL_HOST`, `FRACTO_MYSQL_PORT`, and
`FRACTO_MYSQL_DATABASE`. Database and local tile-source errors identify the
failed check and likely fix. Local-source startup skips creation of the
writable demand-cache directory; tile reads fail closed without network or
demand-cache writes.

### `launch_service.js` and `serve_ui.js`

`launch_service.js` launches one existing service checkout for the supervisor:

```powershell
node scripts/launch_service.js fracto-data-server
node scripts/launch_service.js fracto-asset-server
node scripts/launch_service.js fracto-tiles-server
node scripts/launch_service.js fracto-admin-server
node scripts/launch_service.js fracto-ui
```

Backends run directly through Node; the UI is launched through Vite. The
launcher does not update repositories, install packages, copy data, or retry.
`serve_ui.js` is the standalone static UI server used when serving a built UI
without the root supervisor.

### Platform launchers

- `launch-production.bat` / `launch-production.sh`: build and start production.
- `launch-development.bat` / `launch-development.sh`: start the Vite-based
  development stack on ports 3101–3107.
- `cold_boot.bat`: after a host restart, refreshes Git, rebuilds the image,
  optionally refreshes the tile index, and starts production with Compose.
- `ensure_exclusive.bat` / `ensure_exclusive.sh`: check for the other Docker
  mode before launch and, after confirmation, gracefully stop it with
  `docker compose stop`.
- `shutdown.bat` / `shutdown.sh`: detect running production/development
  containers, ask for confirmation, and gracefully stop either selected mode or
  both when no parameter is supplied.
- `first-run.bat`: Windows first-run workflow; builds the image, bootstraps or
  migrates the database,
  refreshes the index, and starts production. It is safe to rerun after
  correcting an error. For the separately controlled first administrator
  provisioning and installer recovery procedure, follow
  [AUTHENTICATION.md](../AUTHENTICATION.md#qualified-installer-procedure).
- `ec2_deploy.sh`: Linux EC2 first-run and update workflow. Run
  `npm run deploy:ec2:first-run` for the initial installation or
  `npm run deploy:ec2:update` for a later release. It clones any missing
  service repositories from the root repository's Git remote (or the
  non-secret `FRACTO_SERVICE_REPOSITORY_BASE_URL` override), then uses the
  root's fast-forward-only repository updater. Git credentials should come
  from the host's SSH agent or credential helper, never from a URL containing
  a token.

  Before changing repositories or containers, the script validates Compose,
  requires OIDC with secure cookies and HTTPS public URLs, checks `.env` and
  `config/*.json` are ignored by Git and have protected permissions, and
  verifies that `config/mysql.json` is usable by the container's `node` user.
  Keep `.env` owned by the installer with mode `600`. A common config setup is
  `sudo chown root:1000 config/*.json && sudo chmod 640 config/*.json`; UID/GID
  1000 is the container's `node` account. Protect any additional files in
  `config/` the same way.

  First-run initializes or migrates the database. If the host tile corpus has
  no `fracto-tile-release.json`, it builds a candidate compiled index from the
  configured indexed manifest, decodes one representative local tile, and
  writes a source/index binding manifest. It does not enumerate the corpus.
  Missing tiles are reported when requested. It then runs
  `startup_preflight.js` inside the production image and starts the
  single `fracto` container; that container supervises the complete seven-port
  application. It does not invoke the standalone tile-service launcher.
  If a pairing manifest already exists, first-run preserves it and validates
  the existing index/source pairing instead of refreshing the index.

  Updates require the existing pairing manifest, fast-forward repositories,
  build the image, stop the running supervisor before applying database
  migrations, run the same full-stack preflight, and start the complete stack.
  They do not refresh or replace the tile index. To intentionally change the
  local corpus/index pairing, use the documented tile release preparation
  procedure before deploying the new pairing. Both paths fail before startup
  when checks fail, retain Docker volumes, and can be rerun after correcting
  the reported problem.

## Database setup and schema changes

### `initialize_database.js` and `initialize-database.bat`

Bootstraps an empty database from `backup/*.sql`, or applies pending numbered
migrations from `database/migrations/` to an existing database. Existing tables
are never dropped or replaced. The batch file runs the Docker maintenance form.
The Docker maintenance form tees output to the persistent `logs` volume while
leaving stdout/stderr unchanged for Compose output.

During a fresh bootstrap, the initializer checks the server's available
collations. If a backup uses MySQL 8's `utf8mb4_0900_ai_ci` but the server does
not support it, only the imported SQL is adapted to
`utf8mb4_unicode_520_ci`; the checked-in backup remains unchanged. This keeps
the seed dumps usable on MariaDB while retaining the closest available Unicode
collation there.

### `reset-database.bat`

Despite its historical name, this now applies pending versioned migrations only.
It does not reset, drop, or reload tables.

### `validate_migrations.js`

Validates migration filenames, numeric versions, the required baseline,
non-empty SQL, and prohibited destructive statements:

```powershell
npm run db:validate
```

This is included in `npm run check` and requires no MySQL connection. See
`database/migrations/README.md` for the complete table/column/index workflow.

### `verify-mysql.bat`

Prints the MySQL host and port injected into the production Docker container.
It does not modify the database.

## Tile index and persistent tile cache

### `start_tiles_local_source.js`

The root command `npm run start:tiles-local-source` starts only the tile service
in strict local-source mode. Before launching, it checks the source directory's
permissions and `LNN` layout, validates the published compiled-index metadata
and packet files, then reads a representative indexed tile. It reads the root
`.env` file when present, with process environment values taking precedence.
Use `npm run start:tiles-local-source -- --check` to run these checks without
starting the service. The normal `npm start` path is unchanged.

### `build_tile_index.js` and `refresh_tile_index.js`

`build_tile_index.js` compiles source packets into a fingerprinted binary cache:

```powershell
npm run tiles:index
```

`refresh_tile_index.js` rebuilds the short-code index and publishes a complete
generation atomically. In local-source mode it reads
`${FRACTO_TILE_SOURCE_DIR}/manifest/indexed.csv` directly; remote-cache mode
continues to fetch `/manifest/indexed.csv` from the configured Fracto source:

```powershell
npm run tiles:refresh
```

Incomplete generations are not published. Startup rejects missing or stale
generations. Refreshing can take about an hour.

For a side-by-side release, set `FRACTO_TILE_INDEX_PUBLISH_CURRENT=false` on
the one-off `index-refresh` container. It leaves the prior `CURRENT` selection
unchanged and prints the completed candidate generation ID. Preflight that
generation by setting `FRACTO_TILE_INDEX_GENERATION_DIR` to its path under
`/var/lib/fracto/index/generations/`. After the candidate source/index pair
passes preflight, select the generation with:

```sh
docker compose -f compose.yaml -f compose.local-tiles.yaml run --rm --no-deps \
  --entrypoint node fracto scripts/select_tile_index_generation.js <generation-id>
```

The selector requires a `COMPLETE` marker, refuses to run while index refresh
holds its lock, and atomically replaces `CURRENT`. It does not delete the
previous generation, so it remains available for rollback.
Refresh and selection both use `REFRESH.lock`; if a lock remains after a
process stops, confirm no index operation is active before removing that lock.

For a local tile-source release, set `FRACTO_TILE_SOURCE_MODE=local`,
`FRACTO_TILE_SOURCE_DIR`, and `FRACTO_TILE_SOURCE_GENERATION` before compiling
the index. The twice-daily `${FRACTO_TILE_SOURCE_DIR}/manifest/indexed.csv`
listing is read directly and trusted as generated from the authoritative file
listing; the release preparation does not enumerate the local corpus. The same
loader reads `blank.csv`, `interior.csv`, and `needs_update.csv` from that
manifest directory for coverage-cache generation. EC2 preflight requires all
four files. A missing local listing fails without an HTTP fallback. After selecting
the completed index generation, `npm run tiles:source-release` checks and
decodes one representative tile, then writes schema-3
`fracto-tile-release.json` with the dataset/index ID, compiled fingerprint,
tile count, and representative short code. Startup validates this binding and
the representative tile. Other missing, unreadable, or malformed tiles fail
when requested; local mode does not fall back to the network. Create the
manifest before making the source root read-only, and never edit a published
manifest in place. Existing schema-2 manifests with exact-inventory
attestations remain supported.

### `create_tile_source_release_manifest.js`

Creates the source-side pairing manifest for a local tile corpus. It
uses `FRACTO_TILE_SOURCE_DIR`, `FRACTO_TILE_SOURCE_GENERATION`, and the
compiled index selected by `FRACTO_TILE_INDEX_DIR` or
`FRACTO_TILE_INDEX_GENERATION_DIR`. It decodes the compiled index's
representative tile and records its short code with the source generation and
index fingerprint. It does not scan the corpus; absent or invalid tiles are
handled when requested. It refuses to overwrite an existing manifest.

### `cold_boot.bat`

Use this after a normally operating Docker host has been restarted:

```powershell
.\scripts\cold_boot.bat
```

Pass `dev` to launch the development Compose target instead:

```powershell
.\scripts\cold_boot.bat dev
```

It runs the repository refresh with the divergence-reset confirmation described
above, `node scripts/build_windows_image.js prod` (or `dev`),
optionally `docker compose run --rm index-refresh`, and finally
`docker compose up -d --no-build fracto` (or the development `fracto-dev` target when
`dev` is passed), in that order. It does not initialize/reset
MySQL, migrate legacy tiles, or delete named volumes. If a stage fails, correct
the issue and rerun the script; the existing published tile-index generation
remains available until a replacement completes. Tile refresh is opt-in: pressing
Enter or answering anything other than `Y` skips it and starts production with the
currently published generation. After startup, the script follows the production
Compose log stream; press Ctrl+C to end log viewing without stopping the container.
Before launching, it asks whether the other mode may be stopped when both modes
are running. Answering `N` leaves the other mode untouched and aborts the launch.

### Archive image builds on Windows

`build_windows_image.js` creates a new compressed source archive on every run,
then gives Docker that archive as binary standard input. This avoids the live
Windows-directory context synchronization that stalled on the ARM64 lab host.
It does not reuse an old downloaded snapshot or skip rebuilding changed source.
The archive is outside the checkout in a newly created temporary directory and
is removed after successful or failed builds. An interrupted process can leave
its temporary archive for local inspection; no existing cache or volume is reset.

The helper reads `docker compose config --format json` to preserve the resolved
image names, Dockerfile, target and build arguments, including `.env` overrides.
Production builds `fracto:local`. Development builds both the production image
(used by the optional index refresh) and `fracto:dev` from the same snapshot.
Cold boot starts the selected image with `--no-build`, preventing an implicit
return to live-directory transfer. Other Windows launchers keep their existing
build behavior; this change is scoped to cold boot and the explicit helper.

`docker_build_context.js` streams USTAR/gzip with bounded memory and detects source
files changing during packaging. It applies the current `.dockerignore` exclusions
before entering ignored directories, keeping Git, dependencies, local `.env`,
configuration, model weights and runtime credentials out of the archive while
retaining `.env.example`. Included links and unsupported ignore syntax fail
explicitly. Basic `*`, `**`, `?` patterns and the existing `.env.example` exception
are supported; other negations, character classes and backslash escapes require
extending the matcher before changing `.dockerignore`. USTAR path/size limits
also fail explicitly. Unsupported Compose build features such as secret mounts
require updating the helper rather than being silently dropped.

Run manually with `node scripts/build_windows_image.js prod` or `dev`.
`test/docker_build_context.test.js` covers excluded secrets/runtime, binary and
long-path archive contents, fresh source, Compose settings and failure cleanup.

To stop servers explicitly, use `shutdown.bat prod`, `shutdown.bat dev`, or
`shutdown.bat` with no parameter. The script reports exactly which requested modes
are running before asking for confirmation and never removes volumes.
Before launching, it asks whether the other mode may be stopped when both modes
are running. Answering `N` leaves the other mode untouched and aborts the launch.

### `tile_cache_status.js`

Performs a read-only scan of the persistent cache and reports file/tile counts,
bytes, temporary files, oldest/newest timestamps, free space, and active index
generation:

```powershell
npm run tiles:status
npm run tiles:status -- --json
```

The scan happens only when invoked and may be slow for millions of files.

### Tile backup and migration

- `backup-tiles.bat` runs the standalone tile backup operation on the host so
  it can access tile files directly. It invokes the root `tiles:backup` npm
  script.
- `migrate_tile_cache_index.js` migrates indexed tiles with bounded concurrency
  and promotes whole legacy directories when an atomic rename is possible.
- `migrate_tile_cache.sh` is the POSIX migration implementation.
- `migrate-tile-cache.sh` is the POSIX Docker wrapper.
- `migrate-tile-cache.bat` is the Windows Docker wrapper.

Migration uses the completed tile index rather than recursively scanning the
legacy tree. It first promotes top-level numeric directories when source and
destination share a filesystem, then performs restart-safe indexed moves for
remaining files. Operations are bounded by `FRACTO_MIGRATION_CONCURRENCY` (default
8), and progress is reported every 100 indexed tiles. Missing indexed tiles are
reported so a later `tiles:backup` run can retrieve them from the cloud. Stop
production and development before migrating; ordinary `docker compose down` does
not remove the destination volume. The original `migrate_tile_cache.sh` scanner
is retained as a fallback when an index generation is not available.

### `run_logged.js`

Runs a command while preserving its stdout/stderr and writing a second,
ANSI-free structured copy to `logs/<label>-log-YYYY-MM-DD.txt`. Each record includes
the workflow label and source script filename. It is used by maintenance
wrappers (`database-init`, index refresh, and tile migration), which are not
already captured by the root supervisor:

```powershell
node scripts/run_logged.js example npm run db:validate
```

The wrapper returns the child command's exit code. Supervisor-managed services do
not use it, preventing duplicate log entries.

### Build identity and launch scripts

`write_build_info.js` records the root and service repository revisions in the
Git-ignored `build-info.json` file. The production and development launchers run
it before building, so the root `/healthz` response and Admin Status page can show
which revisions are running. This is a deployment-consistency check; it does not
contact GitHub or determine whether a revision is current upstream.
The snapshot also carries raw `tag_records` and normalized `tag_events`, allowing
the Admin Commits page to display milestone markers when production images do not
contain `.git` directories.
The snapshot also carries raw `tag_records` and normalized `tag_events`, allowing
the Admin Commits page to display milestone markers when production images do not
contain `.git` directories.

## Validation, testing, and diagnostics

### `check_syntax.js`

Runs `node --check` over root JavaScript, handlers, scripts, and SDK files:

```powershell
npm run check:syntax
```

### Automated tests

`npm test` runs the numerical, tile-path, and HTTP health integration tests.
`npm run check` combines syntax validation, migration validation, and tests.

### `docker_smoke_test.js`

`npm run test:docker` builds production, starts it, checks `/readyz`, tile cache
diagnostics, and UI availability, then runs ordinary `docker compose down`.
It refuses to interrupt a running production container and never removes volumes.
Use `FRACTO_DOCKER_SMOKE_TIMEOUT_MS` to change its five-minute timeout. It
requires an initialized database and completed tile-index volume.

## Build and cleanup maintenance

### `clean-build.bat`

After confirmation, removes host `node_modules` directories and prunes Docker
builder cache. It preserves images, containers, named volumes, tile data, and
tile-index data.

### Runtime logging and health behavior

The supervisor writes newline-delimited JSON records under `logs/`, with
timestamp, service, source script, level, and ANSI-free message fields. Console output remains
colored. Generated dated service logs older than 30 days are removed at startup;
set `FRACTO_LOG_RETENTION_DAYS` to change that interval.

The supervisor exposes `/healthz` and `/readyz`. The data service probe checks
MySQL. Set `FRACTO_ALLOW_DEGRADED_DB=true` to allow startup with a degraded data
service while keeping `/readyz` at HTTP 503 until MySQL recovers.

## Troubleshooting

- **Tracked changes block updates:** commit, stash, or revert them in the named repository.
- **Missing dependencies:** run `npm ci` in the affected service repository.
- **Missing/stale tile index:** run `npm run tiles:refresh`.
- **Database failure:** run `npm run start:check` and inspect the configured host, port, credentials, and initialization state.
- **Service health timeout:** inspect the dated JSON log under `logs/`; adjust `FRACTO_STARTUP_TIMEOUT_MS` only when initialization is legitimately slow.
- **Port already in use:** stop the existing supervisor or isolated service.
- **Docker cache concern:** use ordinary `docker compose down`; do not use `down --volumes` unless deleting persistent data is intentional.

`README.md` itself is not executable, but it is part of the operational design
context used when maintaining this system. Any manual edits to it must remain
accurate and synchronized with the scripts, Docker configuration, and documented
workflows.

Database initialization now serializes migration/bootstrap work with a
database-specific advisory lock. `database_backup_columns.js` extracts the
dump's original table columns so refreshes preserve fields added by later
migrations. Migration 003 adds nullable minibrot ray-path storage; see
[the migration guide](../database/migrations/README.md) and
[ray cache contract](../sdk/orbitals/RAY_CACHE.md). No existing migration checksum
or backup dump was modified.

## WordNet mapping seed

`wordnet_mapping_seed.js` validates and converts the curated worlds definitions
and contender glosses into a numbered SQL snapshot. Migration 004 holds the initial
318 entries. Apply it with `npm run db:migrate`.

To create a new snapshot at an unused migration path:

```powershell
node scripts/wordnet_mapping_seed.js database/migrations/NNN_wordnet-snapshot.sql
```

The generator refuses to overwrite files. Applied migrations are immutable; review
future snapshots or write a targeted migration for schema/seed changes. Routine
world_name and notes edits now use the data service POST /data/request API.
UTF-8 hex literals preserve quotes, backslashes and Unicode in source text.

## World-name suggestions

`world_name_suggestions.js` validates the pipe-delimited editorial proposal in
`database/seeds/world-name-suggestions-v1.txt` against all current senses. It
rejects missing rows, duplicate candidates, theme mismatches and more than three
names per row. Run `node scripts/world_name_suggestions.js <new-migration.sql>`
to generate a new snapshot. It refuses overwrites. Migration 006 appends the 375
proposals once without changing world_name or prior explanations; do not
regenerate this immutable snapshot after application.

## World notes Markdown formatting

`world_notes_markdown.js` makes a formatting-only editorial pass over current
world notes using the local data API. Run in the data server's loopback network
context (for development, `docker compose -f compose.yaml -f compose.dev.yaml exec
-T fracto-dev node scripts/world_notes_markdown.js`). Default mode previews changes.
Use `--apply --backup /tmp/world-notes-before-markdown.json` to save a UTF-8 recovery
snapshot before updating records. Choose a new backup path for each run; existing
files are never overwritten. The backup is operational recovery data, not a seed
or migration. Container `/tmp` backups last only for that container's lifetime.

The pass adds a suggestion heading, bold candidate names, and nested labeled
source/review details without changing words, references or candidate order.
Content-equivalence and idempotence checks run before writes; each write uses the
previous notes as an expected value, then a full readback verifies every field.
A conflict stops the batch; already completed rows remain saved, and rerunning
skips formatted records. It is a first-pass formatter, not a general Markdown
rewriter: per-world refinements remain deliberate editorial changes. Existing
formatted notes and notes without the historical suggestion marker are untouched.

The AI service participates in repository updates, first-run checks, Docker smoke tests, formatting and milestone tags.

`verify_seed_survey_orbitals.js [source_id=65] [report_path] [existing_run_uuid]`
verifies one explicit application discovery against Seed Surveys and retrieves
its stored cycles and validated landing ratios. Optional UUID verifies a prior
run without starting work. It requires migrations 007–009 and a running data
service. No backfill or source edits occur. `benchmark_orbital_survey.js 65 250 1`
read-only benchmarks the full scan and optional zero-based orbital ray search.

`recalculate_stored_orbitals.js [manifest_path]` is opt-in maintenance for the
focal points already represented in orbital storage, not the bailiwick catalog.
It freezes that inventory, validates source coordinates, starts idempotent
100-result jobs through the data service, and compares ranked results with the
Seed Surveys scan and direct MySQL reads. It verifies that historical points,
source rows, and the focal-point set remain unchanged. The manifest records
progress and permits resuming the same jobs. Landing-ray stages retain the
normal accuracy budgets and can take substantially longer than discovery.

`verify_orbital_resume.js` reads core point 65 and writes only a disposable
verification schema. It proves canceled-scan and hard-crash recovery, unchanged
discovery counts/rankings, preserved ray families, skipped finished orbitals,
single-owner concurrent resumes, stale-owner fencing, and finalization recovery.
It removes its own schema and writes logs/orbital_resume_verification.json. It
performs no application-data recalculation or backfill.
