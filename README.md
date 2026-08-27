# fracto

Main server for the Fracto mediaplex.

## Setup

The services under `servers/` are independent repositories. Check out each service and install its locked dependencies before starting Fracto. Startup deliberately does not clone, pull, copy data, or install packages.

```powershell
npm ci
npm run start:check
npm start
```

`npm run start:check` verifies all five service checkouts, entry points, ports, start scripts, and dependency directories without launching processes.

`npm start` first loads the tile index while no HTTP server is listening. After the tile service becomes healthy, it starts the root server and remaining services sequentially, waiting for each health endpoint before continuing. Tile-index progress is shown in the console. The default health timeout is 120 seconds and can be changed with `FRACTO_STARTUP_TIMEOUT_MS`. Service output is appended to dated files under `logs/`.

Stop the root process with Ctrl+C to forward shutdown to every child service.

## Validation

```powershell
npm run check
```
