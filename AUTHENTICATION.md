# Fracto authentication contract

This document defines the requirements for the user-aware application work.
It is a design contract for the authentication stages; it does not itself
enable authentication.

## Initial objective

The application must know which authenticated person is using it and must
allow access only to users that have been explicitly admitted. Roles and
fine-grained permissions are intentionally deferred.

The first authorization question is therefore:

> Is this authenticated identity enabled in the Fracto user allowlist?

## Identity provider

The production integration is provider-agnostic OpenID Connect (OIDC). The
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

The first user record is created by an explicit administrative/bootstrap
operation. There is no automatic approval based only on a successful login.
New identities are disabled until an administrator enables them.

The initial user record needs to support:

- provider and provider subject;
- email and display name;
- enabled/disabled state;
- created, updated, last-login, and last-seen timestamps;
- a reserved role value for future authorization work.

Authentication events should be retained separately from the user record so
accepted, rejected, disabled-user, logout, and error events can be audited.

## Session boundary

After successful allowlist validation, the main server creates a server-side
session and returns only an opaque session cookie to the browser. The cookie
must be `HttpOnly`, `Secure` in production, and `SameSite`-restricted. Session
expiry, renewal, logout invalidation, and direct endpoint enforcement belong
to the main server.

The initial implementation uses an in-memory session store so the endpoint
contract can be exercised safely before the provider integration is enabled.
Those sessions intentionally expire when the main process restarts. A later
production-hardening stage must move session state to a shared durable store
before horizontal scaling is introduced.

Credentialed browser requests are allowed only from `FRACTO_UI_ORIGIN` (which
defaults to the local UI origin). Remote installations must set that value to
the exact UI origin, including scheme and port. `FRACTO_ALLOW_CORS_ALL=true`
is available only as an explicit development escape hatch.

Provider access tokens and client secrets must never be stored in browser
storage or committed to the repository.

## Endpoint contract

The main server reserves these routes:

- `GET /auth/login` — begin provider login;
- `GET /auth/callback` — receive and validate the provider callback;
- `GET /auth/session` — return the current authenticated/anonymous state;
- `POST /auth/logout` — invalidate the current session.

Login and callback return a clear configuration response until an OIDC
provider is configured. Session and logout are operational with the temporary
in-memory store, using stable anonymous and invalidation contracts so the UI
can be built before provider integration is enabled.

## Protected-route middleware

The main server now provides two opt-in middleware functions:

- `require_authenticated` returns `401` when no valid session exists;
- `require_enabled_user` returns `403` when a session exists but the user is
  not enabled in the allowlist.

Existing routes are not globally gated during this preparatory stage, so local
development and current clients continue to work. Protected routes should use
`require_enabled_user` once authentication is enabled for the deployment.

## Administrative allowlist workflow

The data server exposes user and login-event operations for the admin service,
not directly for the browser. The admin service proxies these operations only
when the main-server session identifies a user whose reserved `role` value is
`admin`:

- `GET /users` — list user records without credentials;
- `PUT /users/:id` — change only the `enabled` allowlist flag;
- `GET /login_events` — list recent authentication audit events.

The role check is intentionally narrow and is not yet a general role system.
The admin UI can be added later without changing the data ownership boundary.

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

Production authentication is the default. A development bypass may exist only
when explicitly selected through runtime configuration, for example an
authentication mode environment variable, and should be limited to local
development access. It must be visibly reported at startup and must never be
silently enabled when configuration is missing.

The development mode is a convenience for local work, not a replacement for
testing the real OIDC callback and session flow.

## Welcome-page behavior

The welcome page remains the public entry screen. It will later show:

- a session-checking state while `/auth/session` is evaluated;
- a sign-in action for anonymous users;
- an access-denied explanation for authenticated but disabled users;
- the existing application entry action for authenticated users;
- a logout action after entry.

Until the authentication stages are implemented, the current welcome behavior
continues to operate without a login gate.

Authentication remains opt-in during rollout. The main server only enforces
the welcome access gate when `FRACTO_AUTH_REQUIRED=true`; leaving that value
unset preserves the existing application entry behavior while the provider
and initial administrator are being configured.

## Deferred decisions

The following are intentionally postponed:

- role names and permission mappings;
- invitation and approval workflows;
- organization or tenant membership;
- multi-provider account linking;
- administrator UI for managing users;
- password or passkey support independent of the OIDC provider.
