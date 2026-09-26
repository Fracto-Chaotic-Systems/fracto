import { get_auth_config } from "../utils/auth_config.js";
import * as oidc from "openid-client";

import { discover_oidc_provider } from "../utils/oidc_provider.js";
import { normalize_oidc_identity } from "../utils/oidc_identity.js";
import {
  create_auth_transaction,
  clear_auth_transaction_cookie,
  consume_auth_transaction,
  get_auth_transaction,
  get_auth_transaction_cookie,
  set_auth_transaction_cookie,
} from "../utils/auth_transactions.js";

const AUTH_CONFIG = get_auth_config();
const AUTH_MODE = AUTH_CONFIG.mode;
const AUTH_REQUIRED = AUTH_CONFIG.required;

import {
  AUTH_COOKIE_NAME,
  clear_session_cookie,
  create_session,
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
  AUTH_CONFIG.configured;

const unavailable_response = (res) => {
  res.status(503).json({
    error: "Authentication provider is not configured",
    auth_mode: AUTH_MODE,
  });
};

const safe_return_to = (value) => {
  const requested = `${value || "/"}`;
  return requested.startsWith("/") && !requested.startsWith("//")
    ? requested
    : "/";
};

const redirect_to_ui = (res, return_to = "/", error_code = null) => {
  let destination;
  try {
    destination = new URL(safe_return_to(return_to), AUTH_CONFIG.ui_origin);
  } catch {
    destination = new URL("http://localhost:3006/");
  }
  if (error_code) destination.searchParams.set("auth_error", error_code);
  res.redirect(destination.href);
};

const callback_error_code = (provider_error) => {
  switch (`${provider_error || ""}`) {
    case "access_denied":
      return "access_denied";
    case "login_required":
      return "login_required";
    case "server_error":
    case "temporarily_unavailable":
      return "provider_unavailable";
    default:
      return "provider_error";
  }
};

const callback_url = (query) => {
  const url = new URL(AUTH_CONFIG.redirect_uri);
  Object.entries(query || {}).forEach(([key, value]) => {
    (Array.isArray(value) ? value : [value]).forEach((entry) => {
      if (entry !== undefined && entry !== null) {
        url.searchParams.append(key, `${entry}`);
      }
    });
  });
  return url;
};

const provision_user = async (identity, request) => {
  const data_port = Number(process.env.FRACTO_DATA_PORT || 3002);
  const response = await fetch(`http://127.0.0.1:${data_port}/user/upsert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...identity,
      ip_address: request.ip,
      user_agent: request.get("user-agent") || "",
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.user) {
    throw new Error(body.error || `User provisioning failed (${response.status})`);
  }
  return body.user;
};

/** Record a non-secret lifecycle event without exposing provider credentials. */
const record_auth_event = async ({ user, event_type, success, request, details }) => {
  const data_port = Number(process.env.FRACTO_DATA_PORT || 3002);
  const response = await fetch(`http://127.0.0.1:${data_port}/login_event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: user?.id ?? null,
      provider: user?.provider || "unknown",
      provider_subject: user?.provider_subject || "unknown",
      event_type,
      success: success === true,
      ip_address: request?.ip,
      user_agent: request?.get?.("user-agent") || "",
      details,
    }),
  });
  if (!response.ok) {
    throw new Error(`Authentication event recording failed (${response.status})`);
  }
};

/** Start an authentication redirect once the OIDC provider is configured. */
export const handle_auth_login = async (req, res) => {
  if (AUTH_MODE !== "oidc" || !oidc_is_configured()) {
    unavailable_response(res);
    return;
  }
  try {
    const provider = await discover_oidc_provider();
    const code_verifier = oidc.randomPKCECodeVerifier();
    const code_challenge = await oidc.calculatePKCECodeChallenge(code_verifier);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const transaction = create_auth_transaction({
      state,
      nonce,
      code_verifier,
      return_to: safe_return_to(req.query.return_to),
    });
    set_auth_transaction_cookie(res, transaction.state);
    const authorization_url = oidc.buildAuthorizationUrl(provider.configuration, {
      redirect_uri: AUTH_CONFIG.redirect_uri,
      response_type: "code",
      scope: "openid email profile",
      state: transaction.state,
      nonce: transaction.nonce,
      code_challenge,
      code_challenge_method: "S256",
    });
    res.redirect(authorization_url.href);
  } catch (error) {
    console.error("OIDC authorization redirect failed", error.message);
    res.status(502).json({ error: "Authentication provider is unavailable" });
  }
};

/** Complete the provider callback and establish a server session. */
export const handle_auth_callback = async (req, res) => {
  if (AUTH_MODE !== "oidc" || !oidc_is_configured()) {
    unavailable_response(res);
    return;
  }
  const state =
    typeof req.query.state === "string" ? req.query.state : null;
  const transaction_cookie = get_auth_transaction_cookie(req);
  const transaction =
    state && transaction_cookie === state ? get_auth_transaction(state) : null;
  const return_to = transaction?.return_to || "/";

  if (!transaction) {
    clear_auth_transaction_cookie(res);
    if (state) consume_auth_transaction(state);
    redirect_to_ui(res, return_to, "invalid_state");
    return;
  }

  if (req.query.error) {
    clear_auth_transaction_cookie(res);
    consume_auth_transaction(state);
    redirect_to_ui(res, return_to, callback_error_code(req.query.error));
    return;
  }

  if (typeof req.query.code !== "string" || !req.query.code) {
    clear_auth_transaction_cookie(res);
    consume_auth_transaction(state);
    redirect_to_ui(res, return_to, "missing_code");
    return;
  }

  const consumed_transaction = consume_auth_transaction(state);
  clear_auth_transaction_cookie(res);
  try {
    const provider = await discover_oidc_provider();
    const tokens = await oidc.authorizationCodeGrant(
      provider.configuration,
      callback_url(req.query),
      {
        pkceCodeVerifier: consumed_transaction.code_verifier,
        expectedState: consumed_transaction.state,
        expectedNonce: consumed_transaction.nonce,
        idTokenExpected: true,
      },
    );
    const identity = normalize_oidc_identity({
      claims: tokens.claims?.(),
      issuer: AUTH_CONFIG.issuer,
      client_id: AUTH_CONFIG.client_id,
      expected_nonce: consumed_transaction.nonce,
    });
    let user;
    try {
      user = await provision_user(identity, req);
    } catch (error) {
      console.error("OIDC user provisioning failed", error.message);
      redirect_to_ui(res, return_to, "user_provisioning_failed");
      return;
    }
    const session = create_session(user);
    set_session_cookie(res, session.token);
    redirect_to_ui(res, return_to);
  } catch (error) {
    console.error("OIDC authorization-code exchange failed", error.message);
    redirect_to_ui(res, return_to, "token_exchange_failed");
  }
};

/** Return the current session state without exposing provider credentials. */
export const handle_auth_session = (req, res) => {
  const current = session_from_request(req);
  if (current) {
    const enabled =
      current.session.user?.enabled === true ||
      Number(current.session.user?.enabled) === 1;
    set_session_cookie(res, current.token);
    res.status(200).json({
      auth_enabled: AUTH_REQUIRED,
      authenticated: true,
      auth_state: enabled ? "authenticated" : "denied",
      user: public_user(current.session.user),
      auth_mode: AUTH_MODE,
      expires_at: new Date(current.session.expires_at).toISOString(),
    });
    return;
  }
  res.status(200).json({
    auth_enabled: AUTH_REQUIRED,
    authenticated: false,
    auth_state: "anonymous",
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
    if (
      req.auth_user?.enabled !== true &&
      Number(req.auth_user?.enabled) !== 1
    ) {
      res.status(403).json({ error: "User access is not enabled" });
      return;
    }
    next();
  });
};

/** Gate an application route only when authentication is enabled for deployment. */
export const require_enabled_user_if_configured = (req, res, next) => {
  if (!AUTH_REQUIRED) {
    next();
    return;
  }
  require_enabled_user(req, res, next);
};

/** End the current session and append a non-secret logout audit event. */
export const handle_auth_logout = async (req, res) => {
  const token = get_cookie(req, AUTH_COOKIE_NAME);
  const session = get_session(token);
  if (session) {
    try {
      await record_auth_event({
        user: session.user,
        event_type: "logout",
        success: true,
        request: req,
      });
    } catch (error) {
      console.warn("Authentication logout audit failed", error.message);
    }
  }
  destroy_session(token);
  clear_session_cookie(res);
  res.status(200).json({ ok: true });
};
