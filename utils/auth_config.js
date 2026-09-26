const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const configured_value = (name) => `${process.env[name] || ""}`.trim();

const parse_url = (value, name, errors) => {
  if (!value) {
    errors.push(`${name} is required`);
    return null;
  }
  try {
    return new URL(value);
  } catch {
    errors.push(`${name} must be a valid URL`);
    return null;
  }
};

/** Return the non-secret authentication configuration used by the server. */
export const get_auth_config = () => {
  const mode = configured_value("FRACTO_AUTH_MODE") || "oidc";
  const required = process.env.FRACTO_AUTH_REQUIRED === "true";
  const ui_origin =
    configured_value("FRACTO_UI_ORIGIN") ||
    `http://localhost:${process.env.FRACTO_UI_PORT || 3006}`;
  const issuer = configured_value("FRACTO_OIDC_ISSUER");
  const client_id = configured_value("FRACTO_OIDC_CLIENT_ID");
  const client_secret = configured_value("FRACTO_OIDC_CLIENT_SECRET");
  const redirect_uri = configured_value("FRACTO_OIDC_REDIRECT_URI");
  const errors = [];
  const issuer_url = issuer ? parse_url(issuer, "FRACTO_OIDC_ISSUER", errors) : null;
  const redirect_url = redirect_uri
    ? parse_url(redirect_uri, "FRACTO_OIDC_REDIRECT_URI", errors)
    : null;
  const ui_origin_url = parse_url(ui_origin, "FRACTO_UI_ORIGIN", errors);

  if (!(["oidc", "none"].includes(mode))) {
    errors.push(`FRACTO_AUTH_MODE must be "oidc" or "none" (received "${mode}")`);
  }
  if (mode === "oidc") {
    if (!issuer) errors.push("FRACTO_OIDC_ISSUER is required");
    if (!client_id) errors.push("FRACTO_OIDC_CLIENT_ID is required");
    if (!client_secret) errors.push("FRACTO_OIDC_CLIENT_SECRET is required");
    if (!redirect_uri) errors.push("FRACTO_OIDC_REDIRECT_URI is required");
    if (redirect_url && redirect_url.pathname !== "/auth/callback") {
      errors.push("FRACTO_OIDC_REDIRECT_URI must end with /auth/callback");
    }
  } else if (required) {
    errors.push("FRACTO_AUTH_REQUIRED=true requires FRACTO_AUTH_MODE=oidc");
  }
  if (process.env.NODE_ENV === "production") {
    [issuer_url, redirect_url, ui_origin_url].forEach((url) => {
      if (url && url.protocol !== "https:" && !LOCAL_HOSTS.has(url.hostname)) {
        errors.push(`production authentication URLs must use HTTPS (${url.href})`);
      }
    });
  }

  return {
    mode,
    required,
    configured: mode === "oidc" && errors.length === 0 && Boolean(issuer),
    issuer,
    client_id,
    client_secret,
    redirect_uri,
    ui_origin,
    errors,
  };
};

/** Validate authentication settings without ever exposing secret values. */
export const validate_auth_config = () => {
  const config = get_auth_config();
  if (config.required && config.mode === "oidc" && config.errors.length) {
    throw new Error(`OIDC configuration invalid: ${config.errors.join("; ")}`);
  }
  return config;
};

export default get_auth_config;
