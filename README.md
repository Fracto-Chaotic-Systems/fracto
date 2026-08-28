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

Build the image, create the first tile index generation, and start the application:

```sh
docker compose build
docker compose run --rm index-refresh
docker compose up -d
```

After the initial index exists, production can also be built and launched from any
working directory with:

```sh
sh scripts/launch-production.sh
```

The initial index refresh downloads the current manifest from
`fracto.mikehallstudio.com` and can take about an hour. Refreshes can run while the
application serves requests:

```sh
docker compose run --rm index-refresh
docker compose restart fracto
```

The running tile server keeps its existing in-memory index until restarted. Index
refreshes are built as isolated generations and are published only after the source
packets and binary cache both complete. The current and previous completed
generations are retained.

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
volumes.

```sh
docker compose -f compose.yaml -f compose.dev.yaml up --build fracto-dev
```

The equivalent development launcher, which can also be called from any working
directory, is:

```sh
sh scripts/launch-development.sh
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
