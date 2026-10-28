import { parentPort, workerData } from "node:worker_threads";
import FractoTileCache from "../FractoTileCache.js";
import { cache_terrain_plan } from "./Cache.js";

let request_id = 0;
const waiting = new Map();
parentPort.on("message", (message) => {
  const response = message.inventory_response;
  if (!response) return;
  const request = waiting.get(response.id);
  if (!request) return;
  waiting.delete(response.id);
  if (response.error) request.reject(new Error("Mesh inventory update failed"));
  else request.resolve();
});
const inventory_request = (action, short_code) =>
  new Promise((resolve, reject) => {
    const id = ++request_id;
    waiting.set(id, { resolve, reject });
    parentPort.postMessage({ inventory_request: { id, action, short_code } });
  });

try {
  const result = await cache_terrain_plan({
    ...workerData,
    read_tile: (short_code) => FractoTileCache.get_tile(short_code),
    on_progress: (progress) => parentPort.postMessage({ progress }),
    ...(workerData.maintain_inventory
      ? {
          before_write: (code) => inventory_request("begin", code),
          after_tile: (code) => inventory_request("observe", code),
        }
      : {}),
  });
  parentPort.postMessage({ result });
} catch (error) {
  parentPort.postMessage({ error: error.message });
}
