# Main server handlers

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
  events and enforces trusted request origins for mutations.
- `health.js` builds the `/healthz` and `/readyz` response handler. It reports
  uptime, service states, and optional build information; `/readyz` returns
  HTTP 503 until every tracked service is healthy.
- `logs.js` implements `/logs`. It validates the requested service selector,
  collects that service's log records (or all services), and formats them for
  the response. Unknown selectors return HTTP 400.
- `main.js` provides the `/status` placeholder response. The route is protected
  by enabled-user middleware when authentication is required.
- `status.js` provides the public root (`/`) welcome/status response.

Keep route registration and startup orchestration in the root `index.js`; keep
request-specific behavior in these handlers.
