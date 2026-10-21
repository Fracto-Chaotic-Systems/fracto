import { list_client_sessions } from "../utils/auth_sessions.js";
import {
  require_administrator,
  is_lab_readonly_admin_bypass,
} from "../utils/admin_authorization.js";

export const create_clients_handler =
  ({
    authorize = require_administrator,
    lab_bypass = is_lab_readonly_admin_bypass,
    list = list_client_sessions,
  } = {}) =>
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const send = () => res.json({ contract_version: 1, clients: list() });
    if (lab_bypass(req)) return send();
    return authorize(req, res, send);
  };
export const handle_clients = create_clients_handler();
