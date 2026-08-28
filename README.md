# fracto

Main server for the Fracto mediaplex.

## Setup

The services under `servers/` are independent repositories. Check out each service and install its locked dependencies before starting Fracto. Startup does not clone repositories, copy data, or install packages. Before opening any port, it fetches every repository and applies fast-forward-only upstream updates. Tracked or staged changes, detached heads, missing upstreams, and divergent branches abort startup. Untracked runtime files are preserved.

```powershell
npm ci
npm run start:check
npm start
```

`npm run start:check` verifies all five service checkouts, entry points, ports, start scripts, and dependency directories without launching processes.

`npm run tiles:index` compiles the source JSON tile packets into a fingerprinted binary cache under `tiles/cache/indexed/`. Run it whenever the source manifest or packets change. `npm start` first updates the root and all five service repositories, then validates and loads that compiled cache while no HTTP server is listening. A missing or stale cache aborts startup with instructions to rebuild it. Use `npm run update:repos` to run only the repository-update phase. After the tile service becomes healthy, it starts the root server and remaining services sequentially, waiting for each health endpoint before continuing. Tile-index progress is shown in the console. The default health timeout is 300 seconds and can be changed with `FRACTO_STARTUP_TIMEOUT_MS`. Service output is appended to dated files under `logs/`.

Stop the root process with Ctrl+C to forward shutdown to every child service.

## Docker

The production image runs the root supervisor and all five internal services in one
container. Downloaded tiles, generated index generations, assets, and logs use named
volumes and survive ordinary container replacement and `docker compose down`.
The Git-ignored `config/` directory is excluded from the image and mounted read-only
at `/app/config` for the application and index-refresh job.
The browser-visible production tile URL is supplied separately through the
non-secret `FRACTO_PROD_URL` build setting and defaults to
`https://fracto.mikehallstudio.com`.

The data server’s MySQL credentials remain in the local, Git-ignored
`config/mysql.json`. Because `localhost` inside a container refers to the container
itself, Compose defaults the database host to `host.docker.internal` so it can reach
a MySQL server running on the Docker host. Set `FRACTO_MYSQL_HOST` (and optionally
`FRACTO_MYSQL_PORT`) in the environment before launching if MySQL runs elsewhere.
The MySQL server must accept connections from Docker and the host firewall must
allow the configured port.

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
local `backup/` directory. It is guarded against replacing an existing non-empty
database. To intentionally reload an existing database from PowerShell, set the
confirmation for that command and then clear it:

```powershell
$env:FRACTO_DB_INIT_CONFIRM = "reset"
docker compose run --build --rm database-init
Remove-Item Env:FRACTO_DB_INIT_CONFIRM
```

From Command Prompt, use `set FRACTO_DB_INIT_CONFIRM=reset` for the duration of the
command. This drops and recreates the tables represented by the SQL dumps.
The Windows equivalent is:

```powershell
.\scripts\initialize-database.bat
```

To reload an existing database with an interactive confirmation prompt, run:

```powershell
.\scripts\reset-database.bat
```

The index refresh downloads the current manifest from
`fracto.mikehallstudio.com` and can take about an hour. Wait for it to finish
successfully before launching production or development. Otherwise startup stops
with `No completed tile index generation is installed.` This setup is required only
when the index volume is new or has been deliberately deleted.

After cloning the root repository, checking out the five service repositories, and
adding the local secret files under `config/`, the complete Windows first-run setup
can be performed with:

```powershell
.\scripts\first-run.bat
```

This builds the production image, initializes MySQL from `backup/*.sql`, refreshes
the tile index, and starts production. It is safe to rerun after a failed step;
database initialization will refuse to replace a non-empty database unless the
explicit reset workflow is used. Once this finishes, development can be started with
the development launcher below.

#### Rerunning after an error

The first-run script can be rerun after correcting an error. An image-build failure,
MySQL connection failure before tables are loaded, index-refresh failure, or startup
failure can be retried directly. If database initialization fails after creating any
tables, it will refuse to overwrite the non-empty database on the next run. Use
`scripts/reset-database.bat` only when intentionally reloading all SQL dumps. An
interrupted index refresh is safe to retry because incomplete generations are never
published. The workflow does not delete the tile cache or index volumes.

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
Progress is reported after every 100,000 tile files.
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
