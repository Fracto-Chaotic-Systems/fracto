# Main server utilities

`environment_asset_database.js` maintains the MySQL `environment_assets` registry
using the installation's `config/mysql.json` and `FRACTO_MYSQL_*` overrides.
It persists an explicit asset-provenance allowlist, source checksums and history;
arbitrary extensions are excluded. Parameterized, idempotent upserts preserve
creation timestamps. Apply migration 019 before enabling the catalog endpoint.

The Inventory endpoint enables this registry on its catalog store. Listing or
reading metadata reconciles registered JSON into database rows; successful
imports and saves include database synchronization. Existing `asset.json` files
remain the editable portable authority, preserving the direct-save workflow.
Files/binaries are not stored in MySQL. A database failure produces an explicit
503 rather than reporting synchronization success. If the file was already
published, its data is retained; the next metadata read/list or registration
command retries synchronization. No distributed transaction spans disk and MySQL.
Database rows are a queryable projection; do not edit them directly or delete
library folders to remove assets. No automatic database deletion occurs.
Preview resource requests do not access the database. Standalone file tools and
tests may explicitly omit a registry; the HTTP endpoint always enables it.

`blender_asset_conversion.js` launches Blender for `.blend` imports with factory
startup and embedded auto-execution disabled, a two-minute timeout and bounded
captured output. It checks the generated GLB before the importer publishes the
asset. `FRACTO_BLENDER_BIN` can select the native executable; Docker uses Blender
and NumPy installed by the image. Errors are mapped to catalog-safe codes.

`environment_asset_import.js` imports user-selected environment folders from ZIP
envelopes. It retains originals and checksums, expands archives with shared SDK
validation, detects duplicate source sets, assigns collision-free IDs, and stages
files before atomically publishing the catalog index. Its lock guards concurrent
imports; the existing catalog store resolves the live list and preview resources.

`environment_catalog.js` reads registered environment records and saves only
allowlisted attribution fields and modification notes. It serializes edits per
asset, checks the expected SHA-256 revision, and replaces the JSON atomically.
Unknown stored metadata, source checksums and runtime data are preserved.

`startup_benchmark.js` starts the hidden Windows host benchmark bootstrap from
native supervisor startup. It is a no-op on other platforms and reports launch
failures without throwing into application startup. It never waits for sampling.

These modules support the root server and the authentication checks shared by
the Fracto services. Route handlers and the supervisor import them for
configuration, identity and session management, authorization, log handling,
and terminal output formatting.

## Files

- `instrument_transfer.js` defines protocol-1 bounds, canonical manifest identity,
  strict control-body checks and safe error codes shared by admin and asset preview.
- `instrument_transfer_stream.js` validates binary body headers and provides shared
  idle/absolute transfer deadlines for the streaming admin/asset hops.

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

Session client snapshots include a separate non-secret random client ID, a
length-limited user agent captured at login and last authenticated activity.
`list_client_sessions()` expires old records before returning a copied
allowlist of fields. Login-session existence does not establish live browser
presence, and displayed user roles reflect the last session verification.

The logging alias `ai` selects the AI service records.
