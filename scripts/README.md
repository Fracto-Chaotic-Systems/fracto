# Fracto scripts

These scripts support validation, repository updates, tile-cache compilation, and process startup. Run their npm aliases from the repository root unless a section explicitly shows a direct invocation.

Database initialization bootstraps only an empty database from `backup/*.sql`.
For existing installations it applies numbered files under
`database/migrations/` and records checksums in `fracto_schema_migrations`.
Never edit an applied migration; add the next numbered migration instead.

## Normal workflow

```powershell
npm run tiles:index
npm run start:check
npm run check
npm start
```

`npm start` automatically runs `update:repos` through the `prestart` npm hook. Building the tile index remains an explicit operation because the source corpus and generated cache are several gigabytes.

## `update_repositories.js`

Fetches and fast-forwards the root repository and all five repositories under `servers/` before startup.

```powershell
npm run update:repos
```

The script performs all local safety checks and fetches before changing a working tree. It aborts when a repository:

- has tracked or staged changes;
- is missing its `.git` directory or configured upstream;
- is on a detached HEAD; or
- has diverged from its upstream branch.

Untracked runtime files are preserved. Updates use `git merge --ff-only`; the script never creates merge commits, rebases, resets, or installs dependencies. A network or Git failure prevents server startup.

## `build_tile_index.js`

Compiles the JSON tile packet corpus into a fingerprinted V8 binary cache.

```powershell
npm run tiles:index
```

Sources are read from `tiles/manifest/indexed/`. Generated files are written under `tiles/cache/indexed/<fingerprint>/`, which is ignored by Git through the root `tiles/` rule.

The builder:

- fingerprints the manifest and packet file metadata;
- serializes packets individually to stay below Node buffer limits;
- publishes a cache directory only after every packet succeeds;
- reuses a current cache instead of rebuilding it; and
- verifies the tile count from packet contents rather than trusting the manifest total.

Run this command after the packet manifest or any packet changes. Startup fails with a rebuild instruction when the cache is absent or stale. The current corpus requires substantial disk space and may take several minutes to compile.

## `startup_preflight.js`

Checks local startup prerequisites without opening ports or launching services. In
addition to service files, ports, and dependencies, it connects to MySQL with a
five-second timeout and runs `SELECT 1`. The same `FRACTO_MYSQL_HOST`,
`FRACTO_MYSQL_PORT`, and `FRACTO_MYSQL_DATABASE` overrides used by the data
server are honored, so connection failures are reported before any service is
started.

```powershell
npm run start:check
```

It validates unique service ports, service `package.json` files, installed `node_modules`, backend entry points, and the UI start script. It does not check remote repositories or build the tile cache.

## `check_syntax.js`

Runs `node --check` over root JavaScript files and the `handlers/`, `scripts/`, and `sdk/` trees.

```powershell
npm run check:syntax
```

The broader `npm run check` command runs this syntax check followed by the Node test suite.

## `launch_service.js`

Launches one named service from its existing checkout and dependency installation. It is normally called by the root supervisor in `index.js`.

```powershell
node scripts/launch_service.js fracto-data-server
node scripts/launch_service.js fracto-asset-server
node scripts/launch_service.js fracto-tiles-server
node scripts/launch_service.js fracto-admin-server
node scripts/launch_service.js fracto-ui
```

Backends run directly through Node with a 16 GB heap allowance. The UI runs Vite directly through Node, avoiding platform-specific npm shell behavior. On shutdown, signals are forwarded on POSIX systems; Windows terminates the explicitly tracked child process tree with `taskkill` to avoid orphaned services.

The launcher does not clone, pull, install packages, copy data, or retry failed services. Those responsibilities belong to the explicit update/setup phases and the root supervisor.

## Startup sequence

The root supervisor uses these scripts in this order:

1. npm runs `update_repositories.js` through `prestart`.
2. `startup_preflight.js` validates local service prerequisites and the MySQL connection.
3. `launch_service.js` starts the tile server, which validates and loads the compiled cache before opening port 3004.
4. The root server opens port 3001.
5. Remaining services start sequentially, with a health check before each next service.

The health timeout defaults to 300 seconds and can be overridden for one invocation:

```powershell
$env:FRACTO_STARTUP_TIMEOUT_MS = 600000
npm start
```

The supervisor exposes `/healthz` for liveness and `/readyz` for readiness. Both
return JSON with uptime and each service state (`pending`, `starting`, `healthy`,
`failed`, or `stopped`); `/readyz` returns HTTP 503 until every service is healthy.
The Docker `HEALTHCHECK` uses `/readyz`.

## Troubleshooting

- **Tracked changes block updates:** commit, stash, or revert them in the named repository.
- **Missing `node_modules`:** run `npm install` or `npm ci` in the named service repository.
- **Missing or stale tile cache:** run `npm run tiles:index` from the root.
- **Service health timeout:** inspect its dated file under `logs/`; increase `FRACTO_STARTUP_TIMEOUT_MS` only when initialization is legitimately slow.
- **Port already in use:** stop the existing Fracto process tree before starting another instance.
