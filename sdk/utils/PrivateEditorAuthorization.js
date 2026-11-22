import { require_internal_service } from "@fracto/sdk/utils/ServiceAuthorization.js";

// Curl inside a local, auth-disabled service needs no browser session. Otherwise
// reuse the existing private service token; never trust forwarded loopback headers.
export function create_data_request_authorizer({
  env = process.env,
  verify_internal = require_internal_service,
} = {}) {
  return (req, res, next) => {
    if (
      env.FRACTO_AUTH_REQUIRED === "true" ||
      env.FRACTO_INTERNAL_SERVICE_TOKEN
    )
      return verify_internal(req, res, next);
    const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      req.socket?.remoteAddress,
    );
    if (loopback && !req.get("origin")) return next();
    return res
      .status(403)
      .json({ error: "Private data-editor access required" });
  };
}
export const require_data_editor = create_data_request_authorizer();
