import { trusted_mutation_origin } from "./auth_request_origin.js";

const LAB_READONLY_ADMIN_PATHS = new Set([
  "/commits",
  "/logs",
  "/reference/document",
  "/reference/tree",
  "/social",
  "/version",
]);

/**
 * Opt in to GET-only admin views for an isolated lab with auth disabled.
 * User management, audit events, and every non-GET route stay protected.
 */
export const is_lab_readonly_admin_bypass = (req, env = process.env) =>
  env.FRACTO_ADMIN_READONLY_BYPASS === "true" &&
  env.FRACTO_AUTH_MODE === "none" &&
  env.FRACTO_AUTH_REQUIRED !== "true" &&
  req.method === "GET" &&
  LAB_READONLY_ADMIN_PATHS.has(req.path);

/** Verify administrative access with the main server's current session state. */
export const require_administrator = async (req, res, next) => {
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
        !(session.user?.enabled === true || Number(session.user?.enabled) === 1) ||
        session.user?.role !== "admin") {
      res.status(403).json({ error: "Administrator access required" });
      return;
    }
    return next();
  } catch {
    res.status(503).json({ error: "Unable to verify administrator access" });
  }
};
