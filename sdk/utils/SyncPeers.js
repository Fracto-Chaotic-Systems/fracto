import { timingSafeEqual, createHash } from "node:crypto";
const sync_error = (code, status = 409) =>
  Object.assign(new Error(code), { code, status });
export const normalize_peer = (value) => {
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw sync_error("invalid_sync_peer", 400);
  return url.href.replace(/\/+$/, "");
};
export function configured_peers(env = process.env) {
  try {
    const configured = JSON.parse(env.FRACTO_DATABASE_SYNC_PEERS || "{}");
    if (
      !configured ||
      typeof configured !== "object" ||
      Array.isArray(configured)
    )
      throw new Error("Peer map required");
    const peers = new Map();
    for (const [url, entry] of Object.entries(configured)) {
      if (
        !entry ||
        typeof entry !== "object" ||
        Array.isArray(entry) ||
        typeof entry.endpoint !== "string" ||
        typeof entry.token !== "string" ||
        entry.token.length < 32
      )
        throw new Error("Invalid peer entry");
      peers.set(normalize_peer(url), {
        endpoint: normalize_peer(entry.endpoint),
        token: entry.token,
      });
    }
    return peers;
  } catch {
    // Invalid JSON and primitive JSON values must not masquerade as an empty
    // address book. Do not expose configuration values or secrets in errors.
    throw sync_error("invalid_sync_peer_configuration", 503);
  }
}
const token_digest = (value) => createHash("sha256").update(value).digest();
export const require_sync_peer =
  (peers = () => configured_peers()) =>
  (req, res, next) => {
    try {
      const supplied = req.get("x-fracto-sync-token") || "";
      const owner = [...peers().values()].find((p) =>
        timingSafeEqual(token_digest(p.token), token_digest(supplied)),
      );
      if (!owner)
        return res.status(403).json({ error: "sync_peer_unauthorized" });
      req.sync_owner = token_digest(owner.token).toString("hex");
      next();
    } catch {
      res.status(503).json({ error: "invalid_sync_peer_configuration" });
    }
  };
