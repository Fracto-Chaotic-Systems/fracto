import http from "node:http";
import { randomBytes } from "node:crypto";
import express from "express";
import { InstrumentTransferStore } from "../../servers/fracto-asset-server/instruments/transfer_store.js";
import { create_instrument_router } from "../../servers/fracto-asset-server/handlers/instruments.js";
import { create_instrument_transfer_router as asset_router } from "../../servers/fracto-asset-server/handlers/instrument_transfer.js";
import {
  create_instrument_peer_router,
  create_instrument_transfer_router,
} from "../../servers/fracto-admin-server/handlers/instrument_transfer.js";
import { InstrumentTransferJobs } from "../../servers/fracto-admin-server/handlers/instrument_transfer_jobs.js";
import { create_sync_authorizer } from "../../servers/fracto-admin-server/handlers/sync_authorization.js";
import { instrument_request } from "../../servers/fracto-admin-server/handlers/instrument_transfer_client.js";
import {
  download_instrument_file,
  upload_instrument_file,
} from "../../servers/fracto-admin-server/handlers/instrument_transfer_binary.js";
import { transfer_hash } from "../../utils/instrument_transfer.js";

export async function local_topology(source_directory, target_directory) {
  const servers = [],
    secret = randomBytes(32).toString("hex"),
    internal = randomBytes(32).toString("hex");
  const close = async () => {
    for (const server of servers.reverse())
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
  };
  const listen = async (app) => {
    const server = http.createServer(app);
    servers.push(server);
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    return `http://127.0.0.1:${server.address().port}`;
  };
  const owner = transfer_hash("local-verification");
  async function asset(directory, initialize) {
    let store, router, public_router;
    const restart = async () => {
      store = new InstrumentTransferStore({ directory, persistent: true });
      if (initialize) await store.initialize();
      router = asset_router({
        store,
        authorize: (req, res, next) =>
          req.get("x-fracto-service-token") === internal
            ? next()
            : res.sendStatus(403),
      });
      public_router = create_instrument_router({
        directory,
        logger: { error() {} },
      });
    };
    await restart();
    const app = express();
    app.use("/internal/instrument-transfer", (req, res, next) =>
      router(req, res, next),
    );
    app.use("/instruments", (req, res, next) => public_router(req, res, next));
    const base = await listen(app);
    const headers = (identity = owner) => ({
      "x-fracto-service-token": internal,
      "x-fracto-transfer-owner": identity,
    });
    const url = (suffix) => `${base}/internal/instrument-transfer${suffix}`;
    return {
      base,
      restart,
      get store() {
        return store;
      },
      local: (suffix, options = {}, identity) =>
        instrument_request(url(suffix), {
          ...options,
          headers: headers(identity),
        }),
      download: (suffix, options) =>
        download_instrument_file(url(suffix), {
          ...options,
          headers: headers(),
        }),
      upload: (suffix, options, identity) =>
        upload_instrument_file(url(suffix), {
          ...options,
          headers: headers(identity),
        }),
    };
  }
  try {
    const source = await asset(source_directory, false),
      target = await asset(target_directory, true);
    const peer_app = express();
    peer_app.use(
      "/instrument-transfer/peer",
      create_instrument_peer_router({
        local: target.local,
        upload: target.upload,
        peers: () =>
          new Map([
            [
              "http://local-source",
              { endpoint: "http://local-source", token: secret },
            ],
          ]),
      }),
    );
    const endpoint = await listen(peer_app);
    const peers = () =>
      new Map([["http://local-receiver", { endpoint, token: secret }]]);
    const jobs = new InstrumentTransferJobs({
      peers,
      local: source.local,
      download: source.download,
      poll_ms: 100,
    });
    const browser_app = express(),
      origin = "http://local-verification";
    browser_app.use(
      "/instrument-transfer",
      create_instrument_transfer_router({
        peers,
        jobs,
        authorize: create_sync_authorizer({
          env: {
            FRACTO_ADMIN_SYNC_LAB_BYPASS: "true",
            FRACTO_AUTH_MODE: "none",
            FRACTO_AUTH_REQUIRED: "false",
            FRACTO_UI_ORIGIN: origin,
          },
          administrator: (_req, res) => res.sendStatus(401),
        }),
      }),
    );
    const browser_base = await listen(browser_app);
    return {
      source,
      target,
      jobs,
      close,
      request: (suffix, body) =>
        instrument_request(`${browser_base}/instrument-transfer${suffix}`, {
          headers: { origin },
          ...(body ? { method: "POST", body } : {}),
        }),
      receipt: (id) =>
        instrument_request(
          `${endpoint}/instrument-transfer/peer/sessions/${id}`,
          { headers: { "x-fracto-sync-token": secret } },
        ),
    };
  } catch (error) {
    await close();
    throw error;
  }
}
