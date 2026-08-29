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

## Repository and startup orchestration

### `update_repositories.js`

Fetches and fast-forwards the root and five service repositories:

```powershell
npm run update:repos
```

It aborts for tracked/staged changes, detached heads, missing upstreams,
divergent branches, or network/Git failures. It preserves untracked runtime
files and never installs packages, rebases, resets, or creates merge commits.

### `startup_preflight.js`

Checks service package files, ports, entry points, dependencies, and the MySQL
connection (`SELECT 1`) without opening service ports:

```powershell
npm run start:check
```

It honors `FRACTO_MYSQL_HOST`, `FRACTO_MYSQL_PORT`, and
`FRACTO_MYSQL_DATABASE`. Database errors identify the endpoint and likely fix.

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
- `first-run.bat`: Windows first-run workflow; builds the image, bootstraps or
  migrates the database, refreshes the index, and starts production. It is safe
  to rerun after correcting an error.

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

### `build_tile_index.js` and `refresh_tile_index.js`

`build_tile_index.js` compiles source packets into a fingerprinted binary cache:

```powershell
npm run tiles:index
```

`refresh_tile_index.js` downloads the current manifest and publishes a complete
generation atomically:

```powershell
npm run tiles:refresh
```

Incomplete generations are not published. Startup rejects missing or stale
generations. Refreshing can take about an hour.

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
- `migrate_tile_cache.sh` is the POSIX migration implementation.
- `migrate-tile-cache.sh` is the POSIX Docker wrapper.
- `migrate-tile-cache.bat` is the Windows Docker wrapper.

Migration moves legacy numeric tile files into the persistent Docker volume,
preserves restart safety, and reports progress every 100,000 files. It excludes
the obsolete source manifest/index directories. Stop production and development
before migrating; ordinary `docker compose down` does not remove the destination
volume.

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
