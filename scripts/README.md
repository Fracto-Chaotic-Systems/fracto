# Fracto scripts

These scripts are grouped by the work they perform rather than by file type.
Run commands from the repository root. Files under `config/`, `backup/`,
`tiles/`, `logs/`, and each service repository retain their existing ownership
and persistence rules.

## Normal workflow

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

The root supervisor starts the tile service first, then the root server and the
remaining services sequentially. It waits for health endpoints before continuing.
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

Fetches and fast-forwards the root and five service repositories:

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
  development stack on ports 3101–3106.
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
  single `fracto` container; that container supervises the complete six-port
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

It runs `npm run update:repos`, `docker compose build fracto`,
optionally `docker compose run --rm index-refresh`, and finally
`docker compose up -d fracto` (or the development `fracto-dev` target when
`dev` is passed), in that order. It does not initialize/reset
MySQL, migrate legacy tiles, or delete named volumes. If a stage fails, correct
the issue and rerun the script; the existing published tile-index generation
remains available until a replacement completes. Tile refresh is opt-in: pressing
Enter or answering anything other than `Y` skips it and starts production with the
currently published generation. After startup, the script follows the production
Compose log stream; press Ctrl+C to end log viewing without stopping the container.
Before launching, it asks whether the other mode may be stopped when both modes
are running. Answering `N` leaves the other mode untouched and aborts the launch.

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

- `backup-tiles.bat` runs the standalone tile backup operation in Docker.
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
the workflow label and source script filename. It is used only by
maintenance wrappers (`database-init`, index refresh, tile migration, and tile
backup), which are not already captured by the root supervisor:

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
