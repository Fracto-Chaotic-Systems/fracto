import * as oidc from "openid-client";

import { get_auth_config } from "./auth_config.js";

const DEFAULT_DISCOVERY_TTL_MS = 60 * 60 * 1000;
const DISCOVERY_TTL_MS = Number(
  process.env.FRACTO_OIDC_DISCOVERY_TTL_MS || DEFAULT_DISCOVERY_TTL_MS,
);

if (!Number.isFinite(DISCOVERY_TTL_MS) || DISCOVERY_TTL_MS <= 0) {
  throw new Error("FRACTO_OIDC_DISCOVERY_TTL_MS must be a positive number");
}

let cached_provider = null;

/**
 * Discover and cache the configured OIDC provider metadata.
 *
 * The returned configuration object is intentionally kept server-side because
 * it contains the client authentication material used by later token calls.
 * The provider metadata is safe to use for constructing authorization URLs.
 *
 * @param {Object} [options]
 * @param {boolean} [options.force=false] Ignore the current cache entry.
 * @returns {Promise<{configuration: Object, metadata: Object}>}
 */
export const discover_oidc_provider = async ({ force = false } = {}) => {
  const auth_config = get_auth_config();
  if (auth_config.mode !== "oidc" || !auth_config.configured) {
    throw new Error("OIDC provider configuration is incomplete");
  }

  const now = Date.now();
  if (
    !force &&
    cached_provider &&
    cached_provider.issuer === auth_config.issuer &&
    now - cached_provider.discovered_at < DISCOVERY_TTL_MS
  ) {
    return cached_provider;
  }

  const configuration = await oidc.discovery(
    new URL(auth_config.issuer),
    auth_config.client_id,
    auth_config.client_secret,
  );
  const provider = {
    configuration,
    metadata: configuration.serverMetadata(),
    issuer: auth_config.issuer,
    discovered_at: now,
  };
  cached_provider = provider;
  return provider;
};

/** Clear cached metadata, primarily for key rotation and tests. */
export const clear_oidc_provider_cache = () => {
  cached_provider = null;
};

export default discover_oidc_provider;
