const CLOCK_SKEW_SECONDS = 60;

const normalized_issuer = (value) => `${value || ""}`.replace(/\/+$/, "");

const has_audience = (audience, client_id) =>
  Array.isArray(audience)
    ? audience.includes(client_id)
    : audience === client_id;

/**
 * Validate and normalize claims from a provider-verified OIDC ID token.
 *
 * The authorization-code exchange already verifies the JWT signature and
 * nonce through openid-client. These checks make the application contract
 * explicit before identity data is handed to user provisioning.
 */
export const normalize_oidc_identity = ({
  claims,
  issuer,
  client_id,
  expected_nonce,
}) => {
  if (!claims || typeof claims !== "object") {
    throw new Error("OIDC ID token claims are missing");
  }
  if (normalized_issuer(claims.iss) !== normalized_issuer(issuer)) {
    throw new Error("OIDC ID token issuer is invalid");
  }
  if (!has_audience(claims.aud, client_id)) {
    throw new Error("OIDC ID token audience is invalid");
  }
  if (typeof claims.sub !== "string" || !claims.sub) {
    throw new Error("OIDC ID token subject is missing");
  }
  if (
    typeof claims.exp !== "number" ||
    claims.exp <= Math.floor(Date.now() / 1000) - CLOCK_SKEW_SECONDS
  ) {
    throw new Error("OIDC ID token is expired");
  }
  if (
    typeof claims.iat !== "number" ||
    claims.iat > Math.floor(Date.now() / 1000) + CLOCK_SKEW_SECONDS
  ) {
    throw new Error("OIDC ID token issued-at time is invalid");
  }
  if (expected_nonce && claims.nonce !== expected_nonce) {
    throw new Error("OIDC ID token nonce is invalid");
  }

  return {
    provider: "google",
    provider_subject: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    email_verified: claims.email_verified === true,
    display_name:
      claims.name || claims.preferred_username || claims.email || claims.sub,
  };
};

export default normalize_oidc_identity;
