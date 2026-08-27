# Fracto servers

This directory contains the five independently versioned services coordinated by the root Fracto repository. Each subdirectory is its own Git repository with its own dependencies, history, upstream branch, and release lifecycle.

The root repository intentionally ignores `servers/`. Changes inside a service must be committed from that service directory; this overview file is therefore local documentation unless the root ignore policy is changed.

## Service map

| Directory | Port | Runtime | Responsibility |
| --- | ---: | --- | --- |
| `fracto-data-server/` | 3002 | Express | Fractal calculations, tile and asset records, backups, lore, orbitals, radial data, and minibrots |
| `fracto-asset-server/` | 3003 | Express | Asset metadata, image rendering, image import, and asset logs |
| `fracto-tiles-server/` | 3004 | Express | Compiled tile-index loading, tile lookup, coverage, canvas buffers, heat maps, and manifests |
| `fracto-admin-server/` | 3005 | Express | Administrative status, logs, and version reporting |
| `fracto-ui/` | 3006 | Vite and React | Browser interface for administration, data, assets, tiles, and fractal studies |

The root supervisor listens on port 3001 and is located one directory above this folder.

## Repository ownership

Do not treat this directory as a conventional monorepo workspace:

- `fracto/` and every child under `servers/` have separate `.git` directories.
- Run `git status`, commits, and branch operations from the repository that owns the file.
- A root commit cannot include service changes.
- The root `npm run update:repos` command checks and updates all six repositories.
- Tracked or staged changes in any repository block automatic startup updates.
- Untracked runtime files do not block repository updates, though service-specific ignore rules should cover expected artifacts.

## Installation

Install dependencies independently in every service. Use the lockfile when possible:

```powershell
npm ci --prefix servers/fracto-data-server
npm ci --prefix servers/fracto-asset-server
npm ci --prefix servers/fracto-tiles-server
npm ci --prefix servers/fracto-admin-server
npm ci --prefix servers/fracto-ui
```

The UI currently requires the legacy peer-dependency policy recorded in its `.npmrc`. Running through `npm ci --prefix` uses that local configuration.

## Starting the system

The supported full-system entry point is the root repository:

```powershell
npm run tiles:index
npm run start:check
npm start
```

The startup sequence is deliberately ordered:

1. Update the root and all service repositories using fast-forward-only Git operations.
2. Validate service checkouts, dependency directories, ports, and entry points.
3. Start the tile service and load the compiled binary tile cache before opening port 3004.
4. Start the root server on port 3001.
5. Start the data, asset, admin, and UI services sequentially, waiting for each health endpoint.

Service output is appended to dated files in the root `logs/` directory. The root process forwards shutdown to every child and terminates the tracked process tree on Windows.

## Running one service

For supervised behavior without starting the full stack, invoke the root launcher:

```powershell
node scripts/launch_service.js fracto-data-server
node scripts/launch_service.js fracto-asset-server
node scripts/launch_service.js fracto-tiles-server
node scripts/launch_service.js fracto-admin-server
node scripts/launch_service.js fracto-ui
```

The launcher runs backend entry points directly with Node and invokes Vite directly for the UI. It does not update repositories or install dependencies.

Running `npm start` inside a backend service uses `nodemon` and is intended for isolated development. Do not start a second copy when the root supervisor already owns that port.

## Shared root dependencies

The services are separate repositories but are not fully isolated packages. Several import files from the root repository using paths such as:

```text
../../constants.js
../../sdk/FractoIndexedTiles.js
../../sdk/FractoTileData.js
```

Keep the service directory names and their position beneath `servers/` unchanged. Moving a service or running it from another layout can break these imports.

Root-level configuration under `config/` is also shared. It may contain credentials and environment-specific network endpoints and is intentionally excluded from version control.

## Tile server requirements

The tile server no longer builds its index from JSON during startup. Compile the source packets explicitly from the root:

```powershell
npm run tiles:index
```

The command writes a fingerprinted binary cache beneath `tiles/cache/indexed/`. Tile startup validates the source fingerprint and fails when the cache is missing or stale. The cache is large, generated, and not committed.

After port 3004 opens, coverage initialization downloads category CSV files from the configured production endpoint. Coverage data is separate from the compiled local tile index and may represent a newer dataset.

## Validation

Root SDK and startup validation:

```powershell
npm run check
npm run start:check
```

UI validation:

```powershell
npm run lint --prefix servers/fracto-ui
npm run build --prefix servers/fracto-ui
```

The backend service `test` scripts are currently placeholders. Shared numerical behavior is covered by the root Node test suite; HTTP integration coverage remains future work.

## Common problems

- **Repository update aborts:** commit, stash, or revert tracked changes in the named repository.
- **A service exits immediately:** inspect its current dated log under the root `logs/` directory.
- **Port already in use:** stop the existing root supervisor or isolated service before launching another copy.
- **Tile cache is stale:** run `npm run tiles:index` from the root.
- **Tile initialization times out:** verify the cache and adjust `FRACTO_STARTUP_TIMEOUT_MS` only if loading is legitimately slow.
- **UI dependency resolution fails:** use the UI repository's `.npmrc` policy rather than bypassing its lockfile.
- **Shared imports fail:** confirm the service is still located directly under `servers/` inside the root repository.
