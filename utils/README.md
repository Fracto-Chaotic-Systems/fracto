# Main server utilities

These modules support the root server and the authentication checks shared by
the Fracto services. Route handlers and the supervisor import them for
configuration, identity and session management, authorization, log handling,
and terminal output formatting.

## Files

- `admin_authorization.js` provides `require_administrator`, middleware for
  admin-service routes. It forwards the request cookie to the main server's
  `/auth/session` endpoint and allows only an authenticated, enabled user with
  the `admin` role.
- `ansi_colors.js` maps ANSI color codes to CSS colors, wraps short codes in a
  terminal color, and converts ANSI-formatted text into text/color segments for
  display in the UI.
- `auth_config.js` reads the authentication and OIDC environment settings,
  validates the mode and URLs, and reports configuration errors without
  returning secret values.
- `auth_request_origin.js` checks that cookie-authenticated mutations come from
  the configured UI origin. Safe `GET`, `HEAD`, and `OPTIONS` requests pass;
  mutation requests without that exact origin are rejected to help prevent
  cross-site request forgery.
- `auth_sessions.js` manages opaque server-side login sessions and their
  browser cookies. It creates, reads, renews, and destroys sessions, and
  produces the safe public user representation returned to the UI.
- `auth_transactions.js` stores short-lived OIDC login transactions, including
  state, nonce, PKCE verifier, and return path. It binds the browser to the
  transaction with a cookie and consumes each transaction once.
- `logging.js` writes structured root-server log entries, collects and
  normalizes the current day's service log records, and formats responses for
  the main server's logs endpoint.
- `oidc_identity.js` validates the provider-verified ID-token claims used by
  the application, then normalizes the stable subject and optional profile
  fields for user provisioning.
- `oidc_provider.js` discovers the configured OIDC provider metadata and
  caches the server-side client configuration. Its cache can be cleared for
  key rotation or tests.
- `service_authorization.js` protects service APIs when authentication is
  required. It accepts the private internal-service token for supervisor-owned
  calls, otherwise checks the main server's session for enabled-user access;
  it also creates internal-service request headers.
- `windowed_metrics.js` aggregates low-cardinality request and duration
  samples into periodic JSON log records. Callers must use static metric names
  and outcome labels; do not pass request parameters, cookies, user IDs, or
  provider identity data.

Authentication secrets and session tokens are runtime data. Do not add them to
this documentation or commit them to Git.
