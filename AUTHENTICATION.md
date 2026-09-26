# Fracto authentication contract

This document records the implemented authentication contract and the remaining
work. Google OIDC, user provisioning, server-side sessions, and enabled-user
checks are implemented. Enforcement is selected through runtime configuration.

## Initial objective

The application must know which authenticated person is using it and must
allow access only to users that have been explicitly admitted. Roles and
fine-grained permissions are intentionally deferred.

The first authorization question is therefore:

> Is this authenticated identity enabled in the Fracto user allowlist?

## Identity provider

The current provider is Google through OpenID Connect (OIDC), with issuer
`https://accounts.google.com`. Discovery is configurable, but identity
normalization currently assigns `provider: "google"`; other providers require
additional implementation. The
browser may initiate the redirect, but the main server must validate the
returned authorization response and identity claims. Browser fingerprints,
IP addresses, user-agent strings, local storage, and client-supplied identity
headers are not identities and must never grant access.

The stable identity key is the pair:

```text
provider + provider_subject
```

Email and display name are profile information and must not be used as the
primary identity key.

## Access states

The UI and server should distinguish these states:

- `checking` — the existing session is being validated;
- `anonymous` — no valid session exists;
- `authenticated` — the identity is known and enabled;
- `denied` — the identity is valid but is not enabled in the allowlist;
- `error` — authentication or session validation failed unexpectedly.

Protected API endpoints must enforce the same distinction independently of
the UI. Hiding navigation is not an access-control mechanism.

## Initial user policy

Successful Google login provisions a user record with `enabled=0` by default.
Login updates profile information without changing existing enabled or role
values. There is no automatic approval based only on a successful login.
The first administrator is explicitly created or promoted through bootstrap.

The initial user record needs to support:

- provider and provider subject;
- email and display name;
- enabled/disabled state;
- created, updated, last-login, and last-seen timestamps;
- a reserved role value for future authorization work.

The first administrator can be created or promoted only through the explicit
`npm run auth:bootstrap-admin` operation. It requires the loopback data server,
`FRACTO_BOOTSTRAP_ADMIN_CONFIRM`, and the provider subject from the trusted
OIDC account. The operation sets `enabled=true` and `role=admin`; it is not a
browser endpoint and must not be exposed through a public proxy.

In Docker, run `scripts/bootstrap_auth_admin.js` inside the application
container so its request to the data server is loopback. Development uses
service `fracto-dev` and `FRACTO_DATA_PORT=3102`; production uses service
`fracto` and port `3002`. Both Compose files forward
`FRACTO_BOOTSTRAP_ADMIN_CONFIRM` along with the OIDC settings. The confirmation
passed to the script must match the value configured in the running data
server. Supply `FRACTO_BOOTSTRAP_ADMIN_SUBJECT` and optional email/name values
to the script. Existing sessions reload the updated user state on their next
session or protected-route check; signing out and in also refreshes the UI.

Authentication events should be retained separately from the user record so
accepted, rejected, disabled-user, logout, and error events can be audited.

## Session boundary

After successful OIDC validation and user provisioning, the main server creates
a server-side session, including for disabled users, and returns only an opaque
session cookie to the browser. Enabled-user authorization is separate. The cookie
must be `HttpOnly`, `Secure` in production, and `SameSite`-restricted. Session
expiry, renewal, logout invalidation, and direct endpoint enforcement belong
to the main server.

The current implementation uses an in-memory session store.
Those sessions intentionally expire when the main process restarts. A later
production-hardening stage must move session state to a shared durable store
before horizontal scaling is introduced.

Before authorizing a session or a protected main-server request, the main server
reloads the user through the data server's loopback-only
`GET /user/session/:id` endpoint. Enabled and role changes therefore apply on the
next check, including to sessions created before the change. Missing or replaced
identities invalidate the session. Lookup failures return `503` and do not grant
cached access. The lookup has a five-second timeout and adds a database read per
check; no authorization cache is used. Requests already authorized before a
change are not cancelled. Logout or expiry during the lookup cannot renew the
invalidated session.

The main server normalizes MySQL numeric `1` and boolean `true` as enabled in
session responses and authorization checks. The admin service accepts both
representations and also requires `auth_state: "authenticated"` and role `admin`.

Credentialed browser requests are allowed only from `FRACTO_UI_ORIGIN` (which
defaults to the local UI origin). Remote installations must set that value to
the exact UI origin, including scheme and port. `FRACTO_ALLOW_CORS_ALL=true`
is available only as an explicit development escape hatch.

Provider access tokens and client secrets must never be stored in browser
storage or committed to the repository.

### Session and request protections

Logout invalidates the session before awaiting best-effort audit logging and
clears both session and pending OIDC transaction cookies. Audit and provisioning
requests have five-second timeouts. Successful login replaces the browser's old
session token. Session expiry is sliding (eight hours by default); an expired
session cannot be renewed. Cookies are host-only, `HttpOnly`, `SameSite=Lax`, and
`Secure` in production or when explicitly configured. Session responses and
authentication redirects use `Cache-Control: no-store`.

Cookie-authenticated mutations through the main/admin authorization guards,
including logout, require an `Origin` exactly matching `FRACTO_UI_ORIGIN`.
Missing, opaque (`null`), and foreign origins are rejected. The development
CORS escape hatch does not disable this check. Admin forwarding preserves the
origin for the data service's second check. Internal provisioning, bootstrap,
and session lookup additionally reject browser Origin/Fetch Metadata headers;
they retain their loopback network boundary.

Backups use `POST /backup?table=...` with administrator and origin checks;
the previous GET endpoint is removed. Direct maintenance clients must use POST,
an enabled administrator cookie, and the configured UI origin. Main, admin,
and data CORS responses vary by Origin and handle preflight without requiring a
session. These checks do not close the general service-access gap below.

## Endpoint contract

The main server implements these routes:

- `GET /auth/login` — begin provider login;
- `GET /auth/callback` — receive and validate the provider callback;
- `GET /auth/session` — return the current authenticated/denied/anonymous state;
- `POST /auth/logout` — invalidate the current session.

Login and callback return `503` if OIDC is not configured; otherwise they perform
the provider flow. Session and logout operate against the in-memory store.
`authenticated: true` in a session response means the identity has a valid
session; `auth_state` distinguishes enabled access from `denied` access.

## Protected-route middleware

The main server now provides two opt-in middleware functions:

- `require_authenticated` returns `401` when no valid session exists;
- `require_enabled_user` returns `403` when a session exists but the user is
  not enabled in the allowlist.

Application routes use an environment-aware wrapper around the enabled-user
middleware. When authentication is required, the main server protects its
application endpoints while leaving health checks and authentication routes
available. When authentication is optional, the wrapper passes through so
local development retains its existing behavior.

The UI applies the same boundary to client routes: only an enabled session (or
explicit local bypass mode) can render application pages. Direct navigation to
an application URL while anonymous, denied, or in an error state returns to the
public welcome screen. While checking, a protected route renders the welcome
page with checking status without changing the requested URL. The application
header stays hidden until access resolves to authenticated or bypass.
This client guard complements server authorization.

## Administrative allowlist workflow

The data server exposes user and login-event operations for the admin service,
not directly for the browser. The admin service proxies these operations only
when the main-server session identifies a user whose reserved `role` value is
`admin`:

- `GET /users` — list user records without credentials;
- `PUT /users/:id` — change only the `enabled` allowlist flag;
- `GET /login_events` — list recent authentication audit events.

The role check is intentionally narrow and is not yet a general role system.
The admin service also requires the session to be enabled before accepting the
reserved admin role. The admin browser client uses credentialed requests, and
the service allows them only from the configured UI origin (or the explicit
development CORS escape hatch). The admin UI can be expanded later without
changing the data ownership boundary.

The data server also checks enabled-administrator access directly for `/users`,
`/login_events`, `PUT /user/:id`, queries of `users`, backups, and schema requests
targeting `users` or `login_events`. The admin proxy forwards the session cookie
for this second check. These admin checks remain active in bypass mode. Data
query and backup clients send credentials, and data-service CORS permits them
from the configured UI origin.

### Service API access controls

When `FRACTO_AUTH_REQUIRED=true`, application APIs on the main, data, asset,
tile, and admin services require a current enabled-user session. Admin-service
application routes and the data user-management routes require an enabled
administrator. Health and status routes remain available for monitoring, and
admin `/ports` remains available for UI service discovery. The data service
allows only the UI's fixed 4800-by-4800 image query anonymously so the public
welcome page can display its background; other asset-list queries require an
enabled session.

The supervisor generates a random per-process `FRACTO_INTERNAL_SERVICE_TOKEN`
and passes it to backend services, but not to the UI. Internal asset and tile
calls use the token to reach protected APIs. Data schema provisioning and other
narrowly scoped internal calls require the token, while OIDC provisioning,
login-event recording, bootstrap, and session lookup retain their loopback
checks. If authentication is disabled, application routes keep bypass behavior.

Browser requests send the session cookie across service ports. Cookie-authenticated
mutations must match the configured UI origin. Backend CORS permits credentialed
requests only from that origin (or an explicitly configured all-origins setting).

Successful enabled logins and disabled identities are recorded during user
provisioning, and session logout appends a separate `logout` event. Audit
recording is best-effort for logout: failure to write an audit event does not
leave a valid session active. In contrast, an audit insert failure during
provisioning currently fails that operation and prevents session creation.
Complete rejected/error callback audit coverage remains to be verified.

## Production-readiness checklist

Before enabling authentication for a public deployment:

- configure and verify the OIDC issuer, client id, and redirect URI;
- set `FRACTO_UI_ORIGIN` to the exact browser origin;
- enable secure cookies behind HTTPS;
- create and explicitly enable the first administrator;
- verify rejected and disabled-user audit events;
- replace the temporary in-memory session store with a shared durable store
  before running more than one main-server instance;
- test logout, expiry, callback failures, and direct protected-endpoint access.

## Local development

`FRACTO_AUTH_MODE` defaults to `oidc`, but enforcement is independently controlled
by `FRACTO_AUTH_REQUIRED`. Only the exact value `true` enables enforcement;
`false` or an unset value allows bypass. Both Compose files default this flag
to `false`. Deployments requiring authentication must explicitly set it to `true`.

With enforcement disabled, `/auth/session` reports `auth_enabled: false`, and
the UI selects `bypass` regardless of session identity. The main server's
environment-aware application gate passes requests through. Admin user-management
operations still require an enabled administrator session. The existing welcome
entry action remains manual in bypass mode.

The development mode is a convenience for local work, not a replacement for
testing the real OIDC callback and session flow.

## Startup configuration validation

The main server validates authentication settings before starting its services.
When `FRACTO_AUTH_REQUIRED=true`, OIDC mode requires a valid issuer URL, client
ID, client secret, UI origin, and callback URL ending in `/auth/callback`.
Invalid or incomplete required configuration stops startup. When authentication
is optional, the same issues are reported as a sanitized warning without
printing secret values, allowing local bypass mode to continue.

Provider discovery is performed server-side and cached for a bounded interval
(`FRACTO_OIDC_DISCOVERY_TTL_MS`, one hour by default). The cached metadata
contains the provider authorization, token, and JWKS endpoints; it is never
returned to the browser. The cache can be invalidated when provider metadata or
signing keys need to be refreshed.

Each login redirect creates a short-lived, single-use server-side transaction
containing a random state, nonce, PKCE verifier, and validated return path. The
state is also bound to an HTTP-only transaction cookie. The authorization URL
requests the `openid`, `email`, and `profile` scopes and uses the S256 PKCE
challenge. No verifier, client secret, or provider token is sent to the browser.

The callback validates the transaction cookie and state before handling any
provider response. Provider denials, missing codes, expired transactions, and
state mismatches are converted to safe UI error codes such as `access_denied`,
`missing_code`, or `invalid_state`; raw provider descriptions are not echoed
to the browser. A valid code proceeds to the server-side token exchange.

Failure redirects always land on welcome. Return paths reject foreign origins,
backslashes, and control/whitespace characters. A mismatched browser cookie does
not consume another browser's transaction. Valid transactions are consumed once
before exchange, so replay cannot create another session. The UI consumes the
failure marker and shows a fixed retry message rather than raw provider text.

The server performs the authorization-code exchange with the discovered token
endpoint using the stored PKCE verifier. The callback URL is reconstructed from
the configured redirect URI rather than from request host headers. The token
response is kept in memory for identity processing and is never written to logs,
cookies, redirects, or API responses.

After exchange, the ID-token claims are checked for issuer, audience, subject,
expiry, issued-at time, and nonce. The application identity is keyed by the
provider and stable `sub` claim; email is retained as profile metadata and is
not used as the identity key.

The normalized identity is upserted by the data server, which owns the MySQL
connection. Login refreshes profile metadata and timestamps without changing
the existing `enabled` or `role` values, then appends an `authenticated` event
with success for enabled users or a `disabled` event without success for disabled
users. Provider tokens never cross into the data server.
The provisioning endpoint is restricted to loopback requests because it is an
internal main-server-to-data-server operation, not a browser API.

After provisioning, the main server creates an opaque in-memory session and
attaches it to the response as a separate HTTP-only session cookie. The
one-time OIDC transaction cookie is cleared in the same response. The session
stores the canonical user record, including its current `enabled` and `role`
values, but never stores provider tokens. Authorization remains a separate
middleware decision: a valid but disabled user can have a session while
protected routes still return `403`. After an administrator enables the user,
the next session check reloads the enabled state.

## Welcome-page behavior

The welcome page remains the public entry screen. It shows:

- a session-checking state while `/auth/session` is evaluated;
- a sign-in action for anonymous users;
- an access-denied explanation for authenticated but disabled users;
- automatic application entry for enabled users who land on `/`;
- a logout action after entry.

The UI requests `/auth/login?return_to=%2F`, so the callback returns to welcome
and waits for session validation. Starting login does not select an application
page. The guarded authenticated transition is the sole automatic entry owner.
`App.jsx` also invokes the existing application-entry callback and replaces `/`
with `/study` when an authenticated session is detected on welcome. A guard
remains mounted across routes, consumes each authenticated transition once, and
resets when leaving authenticated. Session refreshes and effect replays do not
repeat entry; an existing application route keeps its location and selection.

Checking status now appears on welcome while preserving a protected destination.
Neither welcome nor `WelcomeOIDC` offers a manual start action for authenticated
users; bypass retains its manual entry behavior. Anonymous and error states offer
sign-in, and denied users see their access status without an entry action.

The manual welcome callback permits navigation only in bypass mode, keeping it
separate from authenticated entry. Focused tests exercise the entry effect,
actual JSX render decisions, and login initiation, including guard reset, route
preservation, welcome actions, and the callback destination, without a browser
or React mount. Live Google login, refresh, and logout/login behavior are also
verified in the step 8 validation notes below.

Run `npm test` at the root for endpoint and session-security regressions and
`npm run test:auth` in `servers/fracto-ui` for entry and callback-error tests.
Callback tests simulate provider exchange; they do not replace a live Google
login, deployment CORS checks, or browser cookie verification behind HTTPS.

### Authentication regression coverage

The step 7 checklist is covered by the following automated checks:

| Scenario | Coverage |
| --- | --- |
| First enabled login enters once | UI session loading and entry-effect tests; simulated callback session creation |
| Refresh preserves the application route | UI checks for all five application routes, including checking before session resolution |
| Repeated checks do not navigate again | UI session refresh and effect replay tests |
| Disabled users remain denied | UI denied state; HTTP enabled-user and administrator gates, including existing sessions |
| Logout then login permits entry again | UI logout/session/entry sequence; HTTP old-token rejection and new-session acceptance |
| Expired or invalid session returns to welcome | HTTP anonymous responses and protected-route rejection; UI anonymous response routing |
| Bypass retains manual entry | Actual configuration checks for false/unset enforcement; UI bypass with or without a denied identity |

The UI suite exercises the actual component methods and JSX with simulated
React/router behavior. Provider exchange and database responses are simulated
in automated tests; live Google and development-service checks are recorded
below.

### Service API access controls

When `FRACTO_AUTH_REQUIRED=true`, data, asset, tile, admin, and main-server
application APIs require a current enabled user session. Administrative routes
continue to require the administrator role. Health and status routes remain
available for service monitoring, and the admin `/ports` endpoint remains
available so the UI can discover backend ports before it has loaded a session.

The supervisor creates a random per-process
`FRACTO_INTERNAL_SERVICE_TOKEN` and passes it to backend services, but not the
UI process. Internal asset and tile calls use that token when calling protected
services. Schema provisioning and other narrowly scoped data-server internals
require the token, while OIDC provisioning, login-event recording, bootstrap,
and session lookup retain their loopback-only checks. If auth is disabled, the
application service APIs retain bypass behavior.

Browser requests send the session cookie with credentials across the UI's
service ports. Cookie-authenticated mutations must also match the configured UI
origin. The data, asset, tile, and admin services answer credentialed CORS only
for that origin (or an explicitly configured all-origins setting).

### Step 8 validation record

The UI dependency tree was restored on Windows with `npm ci` from the existing
lockfile; no lockfile edit was needed. All 69 root tests and 16 UI authentication
tests pass. Lint reports the same three existing `process`-undefined warnings in
`vite.config.js`; the production build succeeds with Vite's large-chunk warning.
The machine's global `npm` launcher is broken, so validation commands were run
with Node directly.

The live browser completed Google OIDC sign-in through the configured callback
(`http://localhost:3101/auth/callback`) and entered `/study` automatically.
Refreshing `/study` preserved the route and authenticated UI; signing out
returned to welcome; signing in again automatically re-entered `/study`. This
verifies the callback, browser session, enabled-user decision, refresh behavior,
and one-click entry in the development UI.

After restarting the development container, anonymous probes returned `401`
for main logs, general data and asset APIs, tile metrics, and admin version.
The exact welcome-image query returns `200`, while other asset-list queries
return `401`; health checks and admin port discovery remain public. With an
enabled browser session, the data query view and asset gallery loaded their
records successfully across service ports.

## Reconciliation baseline

At `milestone/authentication-flow-v1`, the enabled-value normalization in the
main and admin servers, OIDC environment forwarding, and bootstrap confirmation
forwarding are committed. The handoff describing those edits as uncommitted is
historical. The data server owns `users` and `login_events`; the main server owns
OIDC transactions and session cookies. The remaining UI transition and session
revocation work described above was added after that milestone. Root regression
tests cover current-user authorization, role changes, lookup failures, deleted
identities, and direct data-route administrator checks with a simulated data
service. Development browser login and database-backed service behavior are
verified above; production HTTPS configuration, shared session storage, and
multi-instance deployment behavior remain outstanding.

## Deferred decisions

The following are intentionally postponed:

- role names and permission mappings;
- invitation and approval workflows;
- organization or tenant membership;
- multi-provider account linking;
- administrator UI for managing users;
- password or passkey support independent of the OIDC provider.
