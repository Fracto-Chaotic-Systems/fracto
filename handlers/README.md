# Main server handlers

The catalog router also maintains the `environment_assets` MySQL registry.
Metadata reads/listing reconcile existing assets, and imports and PATCH saves
synchronize before returning success. Apply migration 019 and run
`node scripts/register_environment_assets.js` when upgrading an existing library.
Database errors use the generic `catalog_unavailable` 503 without exposing
connection details; a subsequent metadata read repairs a pending synchronization.

`environment_catalog.js` supplies the same-origin `/api/environment-catalog/:id`
router hosted by the UI's Vite server and static UI server. GET returns an
allowlisted view and revision. PATCH validates a bounded attribution/note edit,
enforces the configured UI origin and existing enabled-user authentication, then
updates the registered file. It never accepts filesystem paths or whole records
from clients and never logs catalog content. Asset provenance is the narrow
user-authorized exception documented in PROJECT_GUIDELINES.md.

The same router lists registered assets at GET `/api/environment-catalog`, accepts
bounded ZIP envelopes at POST `/import`, and serves only declared preview resources
at GET `/:id/files/*file`. `utils/environment_asset_import.js` preserves originals,
extracts safe ZIP paths, stages metadata and publishes the catalog entry under an
exclusive import lock. Source files receive a restrictive content policy when
served. Imports never accept an absolute host folder path.

Health contract version 1 also includes an additive, non-personal `startup_id`
UUID, stable across this main process's health/readiness requests and replaced
when it restarts. The host benchmark observer uses it to avoid duplicate runs.

The files in this directory implement request handlers mounted by the root
Express server in `index.js`. The server starts the Fracto services, while
these handlers provide its HTTP endpoints and route-level authentication
checks.

## Files

- `auth.js` implements the main server's authentication endpoints and
  middleware. It starts the OpenID Connect authorization flow, validates the
  callback, provisions or loads the user through the data server, creates and
  renews server-side sessions, reports the current session, and handles
  logout. Its middleware distinguishes a valid session from a user enabled by
  the deployment's access policy. It also records non-secret login lifecycle
  events and enforces trusted request origins for mutations. For load
  measurement, it records aggregated duration and outcome counts for the
  internal user-record lookup without logging session or identity values.
- `health.js` builds the `/healthz` and `/readyz` response handler. It reports
  contract version, the configured `FRACTO_SERVER_NAME`, uptime, service
  states, and optional build information. Callers use `GET /healthz` for status
  and identity; `/readyz` returns HTTP 503 until every tracked service is
  healthy. Both read-only endpoints allow cross-origin browser reads without
  credentials so other Fracto main-server UIs can monitor this service.
- `logs.js` implements `/logs`. It validates the requested service selector,
  collects that service's log records (or all services), and formats them for
  the response. Unknown selectors return HTTP 400.
- `main.js` provides the `/status` placeholder response. The route is protected
  by enabled-user middleware when authentication is required.
- `status.js` provides the public root (`/`) welcome/status response.

Keep route registration and startup orchestration in the root `index.js`; keep
request-specific behavior in these handlers.

- `clients.js` provides `GET /clients`, an administrator-only, uncached snapshot
  of unexpired authenticated login sessions. It includes display name, role,
  browser user agent and creation/activity/expiry timestamps. Opaque session
  tokens, cookies, provider subjects and email addresses are excluded. The
  existing explicit lab read-only bypass also permits this GET when auth is
  disabled. An empty list in that mode is expected: anonymous tabs are not
  tracked. Sessions disappear on logout, expiration or process restart.

The centralized log handler also accepts the `ai` service selector.
