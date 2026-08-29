# fracto

Main server for the Fracto mediaplex.

## Setup

The services under `servers/` are independent repositories. Check out each service and install its locked dependencies before starting Fracto. Startup does not clone repositories, copy data, or install packages. Before opening any port, it fetches every repository and applies fast-forward-only upstream updates. Tracked or staged changes, detached heads, missing upstreams, and divergent branches abort startup. Untracked runtime files are preserved.

```powershell
npm ci
npm run start:check
npm start
```

`npm run start:check` verifies all five service checkouts, entry points, ports, start scripts, dependency directories, and the MySQL connection without launching processes. Database failures identify the configured endpoint and suggest the relevant Docker, firewall, credential, or initialization fix.

`npm run tiles:index` compiles the source JSON tile packets into a fingerprinted binary cache under `tiles/cache/indexed/`. Run it whenever the source manifest or packets change. `npm start` first updates the root and all five service repositories, then validates and loads that compiled cache while no HTTP server is listening. A missing or stale cache aborts startup with instructions to rebuild it. Use `npm run update:repos` to run only the repository-update phase. After the tile service becomes healthy, it starts the root server and remaining services sequentially, waiting for each health endpoint before continuing. Tile-index progress is shown in the console. The default health timeout is 300 seconds and can be changed with `FRACTO_STARTUP_TIMEOUT_MS`. Service output is appended to dated files under `logs/`.

Stop the root process with Ctrl+C to forward shutdown to every child service.

## Docker

The production image runs the root supervisor and all five internal services in one
container. Downloaded tiles, generated index generations, assets, and logs use named
volumes and survive ordinary container replacement and `docker compose down`.
Docker sets `FORCE_COLOR=1` so supervisor and service health messages retain Chalk
colors in Compose logs.
The container health check uses the supervisor readiness endpoint (`/readyz`),
which remains unhealthy until every internal service has passed its startup check.
`/healthz` is also available for liveness diagnostics and returns each service's
current state as JSON.
Child-service output is kept colored on the terminal, while the dated files under
`logs/` have ANSI control codes removed so they remain readable in editors and
safe to process with text-search tools. Each persisted line is a JSON record with
`timestamp`, `service`, `source`, `level`, and `message` fields, making the logs suitable for
automated filtering without sacrificing plain-file portability.
Maintenance commands use the same tee behavior: their Docker stdout/stderr still
appears normally in Compose, with one additional structured copy in the persistent
`logs` volume. Supervisor-managed service output is not tee-wrapped, so it is not
duplicated.
An opt-in Docker smoke test builds the production image, starts the stack, checks
`/readyz`, the tile diagnostics, and the UI, then runs ordinary `docker compose
down`. It refuses to run while production is already running and never uses
`--volumes`, so persistent tile and index volumes are preserved:

```powershell
npm run test:docker
```
Generated log files are cleaned up at supervisor startup. Retention defaults to
30 days and can be changed with `FRACTO_LOG_RETENTION_DAYS`; only files matching
Fracto's dated service-log names are eligible for removal.
The tile service also exposes `/cache_status`, reporting request counts, memory
hits, disk loads, downloads, read-only downloads, failures, coalesced requests,
evictions, in-flight work, and cache mode. This is useful for confirming whether
tiles are being loaded from the persistent cache or fetched from the source.
The tile service's `/metrics` endpoint reports request totals, response status
counts, average/max latency, and process start time. Cache download bytes and
download duration are included in `/cache_status`. See
[servers/README.md](D:\mediaplex\fracto\servers\README.md) for the complete
field reference and interpretation guidance.
For a read-only report of persistent cache size, temporary files, free space, and
the active index generation, run `npm run tiles:status` (add `-- --json` for
machine-readable output). The command scans the cache only when explicitly run.
The Git-ignored `config/` directory is excluded from the image and mounted read-only
at `/app/config` for the application and index-refresh job.
The browser-visible production tile URL is supplied separately through the
non-secret `FRACTO_PROD_URL` build setting and defaults to
`https://fracto.mikehallstudio.com`.

The data server's MySQL credentials remain in the local, Git-ignored
`config/mysql.json`. Because `localhost` inside a container refers to the container
itself, Compose defaults the database host to `host.docker.internal` so it can reach
a MySQL server running on the Docker host. Set `FRACTO_MYSQL_HOST` (and optionally
`FRACTO_MYSQL_PORT`) in the environment before launching if MySQL runs elsewhere.
The MySQL server must accept connections from Docker and the host firewall must
allow the configured port.
By default, startup requires MySQL. To allow the rest of the stack to start while
the data service is temporarily unavailable, set `FRACTO_ALLOW_DEGRADED_DB=true`.
The data service is then reported as `degraded`, the supervisor remains not ready
(`/readyz` returns 503), and database-dependent requests continue to report their
own failures until MySQL is restored. The supervisor automatically changes the
service back to `healthy` when its database probe succeeds.

Verify the host and port injected into the production container with:

```powershell
.\scripts\verify-mysql.bat
```

### First-ever Docker run

Both production and development require a completed tile index in the shared
`fracto-tile-index` volume. Before launching either service for the first time,
build the production image and create the initial index generation:

```powershell
docker compose build fracto
docker compose run --rm database-init
docker compose run --rm index-refresh
```

The database step creates the configured database and loads every SQL dump from the
local `backup/` directory only when the database has no tables. Existing databases
are baselined and receive only pending numbered migrations from
`database/migrations/`; tables are never dropped or replaced by this command.
See [database/migrations/README.md](D:\mediaplex\fracto\database\migrations\README.md)
for the complete workflow and examples for adding tables, columns, and indexes.
The Windows equivalent is:

```powershell
.\scripts\initialize-database.bat
```

To apply pending migrations manually, run:

```powershell
.\scripts\reset-database.bat
```

The index refresh downloads the current manifest from
`fracto.mikehallstudio.com` and can take about an hour. Wait for it to finish
successfully before launching production or development. Otherwise startup stops
with `No completed tile index generation is installed.` This setup is required only
when the index volume is new or has been deliberately deleted.

### Cold boot after a computer restart

After a normally operating Docker host is restarted, run:

```powershell
.\scripts\cold_boot.bat
```

Use `.\scripts\cold_boot.bat dev` to run the same workflow but launch the
development Compose target on ports 3101–3106 instead of production.

This refreshes the root and service repositories, rebuilds the production image,
optionally refreshes the cloud-backed tile index, and finally runs `docker compose
up -d fracto`. The script asks `Refresh the compiled tile index now? [y/N]`; Enter
or any answer other than `Y` skips the refresh. It does not initialize/reset
MySQL, migrate legacy tiles, or remove named volumes. The index refresh can take
about an hour; an existing published generation remains available until the
replacement completes.
The repository refresh permits the known local IntelliJ metadata change in
`.idea/fracto.iml`; any other tracked or staged change still stops the workflow.
After `docker compose up -d fracto`, the script follows the Docker log stream.
Press Ctrl+C to stop viewing logs; production continues running.

After cloning the root repository, checking out the five service repositories, and
adding the local secret files under `config/`, the complete Windows first-run setup
can be performed with:

```powershell
.\scripts\first-run.bat
```

This builds the production image, bootstraps an empty MySQL database (or applies
pending migrations), refreshes the tile index, and starts production. It is safe to
rerun after a failed step; existing tables are preserved. Once this finishes,
development can be started with the development launcher below.

#### Rerunning after an error

The first-run script can be rerun after correcting an error. An image-build failure,
MySQL connection failure, migration failure, index-refresh failure, or startup
failure can be retried directly. An interrupted index refresh is safe to retry because
incomplete generations are never published. The workflow does not delete the tile
cache or index volumes.

If this installation already has a non-Docker `tiles/` demand cache, migrate it
after building the image and before launching either service. The migration stops
production and development, moves only numeric tile paths into the Docker volume,
and excludes the obsolete `tiles/cache` and `tiles/manifest` index data:

```powershell
.\scripts\migrate-tile-cache.bat
```

On a POSIX shell:

```sh
sh scripts/migrate-tile-cache.sh
```

Migration is optional when there is no existing cache. It merges with tiles already
in the Docker volume and consumes the legacy numeric tile files; make a backup first
if the original cache must be retained. A cache containing millions of files can
take a long time to move; allow the command to finish before starting production or
development. If the source and Docker volume use different filesystems, Docker may
temporarily copy one file at a time before removing the source file.
Progress is reported after every 100 tile files.
Files are collected into per-level bins, so lower tile levels transfer before
higher levels without globally sorting the file list.
The migration is restartable: stopping it between files leaves the source intact;
the next run retries any incomplete file and removes completed duplicates.

After the refresh completes, choose either production or development below. Do not
use `docker compose down --volumes` during normal operation; that option deletes the
shared tile cache and index.

### Docker production

Start production directly with Compose:

```sh
docker compose up --build -d fracto
```

After the initial index exists, production can also be built and launched from any
working directory with:

```sh
sh scripts/launch-production.sh
```

From PowerShell or Command Prompt on Windows:

```powershell
.\scripts\launch-production.bat
```

Later index refreshes can run while the application serves requests:

```sh
docker compose run --rm index-refresh
docker compose restart fracto
```

The running tile server keeps its existing in-memory index until restarted. Index
refreshes are built as isolated generations and are published only after the source
packets and binary cache both complete. The current and previous completed
generations are retained.

### Download the latest tiles

The `tiles:backup` action compares the current compiled tile index with the local
production cache and downloads any indexed tiles that are not already present from
`https://fracto.mikehallstudio.com`. It is safe to run while production is serving
requests; downloads are written atomically so the server never reads a partial tile.
Run it inside the running production container:

```powershell
docker compose exec fracto npm run tiles:backup
```

It can also run as a separate maintenance container sharing the production volumes:

```powershell
docker compose run --rm --no-deps fracto npm run tiles:backup
```

The same standalone operation is available from any working directory on Windows:

```powershell
.\scripts\backup-tiles.bat
```

The maintenance form runs in the foreground and may take a long time. Rebuild the
production image first if the latest backup script is not yet included:

```powershell
docker compose build fracto
```

Run this action only against production. Development mounts the shared tile cache
read-only and cannot persist downloaded tiles.

The `fracto-tile-data` volume is a demand-filled installation cache. A tile is read
locally when present; otherwise it is downloaded, validated, and atomically stored.
New downloads stop before the filesystem falls below 1 GiB free; override that floor
with `FRACTO_TILE_MIN_FREE_BYTES`. The cloud service remains the source of truth, so
the demand cache and generated index can be reconstructed instead of backed up.
Do not use `docker compose down --volumes` unless all persistent application data is
intended to be removed.

### Docker development

The development override adds a separate `fracto-dev` service, bind-mounts the
working source tree, runs backend processes with Node watch mode, and runs the UI
through Vite with hot-module replacement. Production can remain online at ports
3001-3006 while development uses ports 3101-3106.

Development shares the production tile cache and compiled index read-only. Cached
tiles are reused, but only production can add tiles to the installation cache. When
development requests an uncached tile, it downloads and validates that tile for the
current process without storing it. Development assets and logs use their own named
volumes. Complete the first-ever index procedure above before starting development;
development cannot initialize the read-only index volume itself.

```sh
docker compose -f compose.yaml -f compose.dev.yaml up --build fracto-dev
```

The equivalent development launcher, which can also be called from any working
directory, is:

```sh
sh scripts/launch-development.sh
```

From PowerShell or Command Prompt on Windows:

```powershell
.\scripts\launch-development.bat
```

The production/development launchers enforce mutual exclusion: before starting one mode, they
detect whether the other Docker mode is running and ask for confirmation before
gracefully stopping it. Answer `N` to leave the running mode untouched.
To shut down either mode, or both, use `scripts\shutdown.bat prod`,
`scripts\shutdown.bat dev`, or `scripts\shutdown.bat` with no parameter. It
detects which requested containers are running, asks for confirmation, and stops
them gracefully without removing volumes.

### Clean build dependencies

To recover local disk space or resolve a corrupted dependency/build cache, use:

```powershell
.\scripts\clean-build.bat
```

After an explicit confirmation, this removes `node_modules` from the root and all
five service repositories and clears Docker’s builder cache. It preserves images,
containers, named volumes, tile data, and tile indexes. Rebuild the desired image
afterward; the development launcher will recreate its container dependency volumes
when run with `--renew-anon-volumes`.

Source changes under the root application, SDK, handlers, internal servers, or UI are
visible inside the container immediately. Vite updates the browser; Node restarts
affected backend processes. Open the development UI at `http://localhost:3106`.
Stop development with Ctrl+C, then remove only its container without interrupting
production or deleting data:

```sh
docker compose -f compose.yaml -f compose.dev.yaml rm -f -s fracto-dev
```

Service source mounts are read-only and use container-owned anonymous `node_modules`
volumes so host dependencies never replace Linux dependencies. After changing a
package manifest or lockfile, rebuild and renew those dependency volumes:

```sh
docker compose -f compose.yaml -f compose.dev.yaml up --build --renew-anon-volumes fracto-dev
```

## Validation

```powershell
npm run check
```
