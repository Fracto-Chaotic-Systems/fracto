const AUTH_MODE = process.env.FRACTO_AUTH_MODE || "oidc";
const AUTH_REQUIRED = process.env.FRACTO_AUTH_REQUIRED === "true";

import {
  AUTH_COOKIE_NAME,
  clear_session_cookie,
  destroy_session,
  get_cookie,
  get_session,
  public_user,
  renew_session,
  set_session_cookie,
} from "../utils/auth_sessions.js";

const session_from_request = (req) => {
  const token = get_cookie(req, AUTH_COOKIE_NAME);
  const session = renew_session(token);
  return session ? { token, session } : null;
};

const oidc_is_configured = () =>
  Boolean(
    process.env.FRACTO_OIDC_ISSUER &&
      process.env.FRACTO_OIDC_CLIENT_ID &&
      process.env.FRACTO_OIDC_REDIRECT_URI,
  );

const unavailable_response = (res) => {
  res.status(503).json({
    error: "Authentication provider is not configured",
    auth_mode: AUTH_MODE,
  });
};

/** Start an authentication redirect once the OIDC provider is configured. */
export const handle_auth_login = (req, res) => {
  if (AUTH_MODE !== "oidc" || !oidc_is_configured()) {
    unavailable_response(res);
    return;
  }
  // Stage 3 defines the endpoint contract; provider discovery and redirect
  // construction are implemented by the session stage.
  res.status(501).json({ error: "OIDC login flow is not implemented" });
};

/** Complete the provider callback and establish a server session. */
export const handle_auth_callback = (req, res) => {
  if (AUTH_MODE !== "oidc" || !oidc_is_configured()) {
    unavailable_response(res);
    return;
  }
  res.status(501).json({ error: "OIDC callback flow is not implemented" });
};

/** Return the current session state without exposing provider credentials. */
export const handle_auth_session = (req, res) => {
  const current = session_from_request(req);
  if (current) {
    set_session_cookie(res, current.token);
    res.status(200).json({
      auth_enabled: AUTH_REQUIRED,
      authenticated: true,
      user: public_user(current.session.user),
      auth_mode: AUTH_MODE,
      expires_at: new Date(current.session.expires_at).toISOString(),
    });
    return;
  }
  res.status(200).json({
    auth_enabled: AUTH_REQUIRED,
    authenticated: false,
    user: null,
    auth_mode: AUTH_MODE,
  });
};

/** Require any valid server-side session for a protected route. */
export const require_authenticated = (req, res, next) => {
  const current = session_from_request(req);
  if (!current) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  req.auth_session = current.session;
  req.auth_user = current.session.user;
  set_session_cookie(res, current.token);
  next();
};

/** Require a valid session whose user has been enabled in the allowlist. */
export const require_enabled_user = (req, res, next) => {
  require_authenticated(req, res, () => {
    if (req.auth_user?.enabled !== true) {
      res.status(403).json({ error: "User access is not enabled" });
      return;
    }
    next();
  });
};

/** End the current session; cookie invalidation is added in the session stage. */
export const handle_auth_logout = (req, res) => {
  destroy_session(get_cookie(req, AUTH_COOKIE_NAME));
  clear_session_cookie(res);
  res.status(200).json({ ok: true });
};
