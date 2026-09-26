import { timingSafeEqual } from "node:crypto";
import { trusted_mutation_origin } from "./auth_request_origin.js";

const configured_token = () => process.env.FRACTO_INTERNAL_SERVICE_TOKEN || "";

const has_internal_service_token = (req) => {
  const expected = configured_token();
  const supplied = req.get("x-fracto-service-token") || "";
  if (!expected || !supplied) return false;
  const expected_bytes = Buffer.from(expected);
  const supplied_bytes = Buffer.from(supplied);
  return expected_bytes.length === supplied_bytes.length &&
    timingSafeEqual(expected_bytes, supplied_bytes);
};

export const internal_service_headers = (headers = {}) => ({
  ...headers,
  ...(configured_token() ? { "X-Fracto-Service-Token": configured_token() } : {}),
});

/** Require an enabled user session for service APIs when auth is configured.
 * Supervisor-owned services may authenticate with the private shared token.
 */
export const require_enabled_user_if_configured = async (req, res, next) => {
  if (process.env.FRACTO_AUTH_REQUIRED !== "true" || has_internal_service_token(req)) {
    return next();
  }
  if (!trusted_mutation_origin(req, res)) return;
  try {
    const port = Number(process.env.FRACTO_SERVER_PORT || 3001);
    const response = await fetch(`http://127.0.0.1:${port}/auth/session`, {
      headers: { cookie: req.headers.cookie || "" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Session lookup failed");
    const session = await response.json();
    if (!session.authenticated) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (session.auth_state !== "authenticated" ||
        !(session.user?.enabled === true || Number(session.user?.enabled) === 1)) {
      res.status(403).json({ error: "Enabled account required" });
      return;
    }
    return next();
  } catch {
    res.status(503).json({ error: "Unable to verify authentication" });
  }
};

export const require_internal_service = (req, res, next) => {
  if (has_internal_service_token(req)) return next();
  res.status(403).json({ error: "Internal service access required" });
};
