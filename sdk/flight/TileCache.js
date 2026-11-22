import {
  TILE_EDGE,
  validate_tile_code,
  validate_tile_data,
  tile_bounds,
} from "@fracto/sdk/FractoTileGeometry.js";

export const FLIGHT_TILE_BYTES =
  TILE_EDGE * TILE_EDGE * 2 * Float64Array.BYTES_PER_ELEMENT;
const abort_error = () =>
  Object.assign(new Error("Flight tile request cancelled"), {
    name: "AbortError",
  });
const cache_error = (code) => Object.assign(new Error(code), { code });

/** Per-game numerical cache. Transport is injected; no React, DOM or global cache. */
export function create_flight_tile_cache({
  load_tile,
  load_availability,
  max_tiles = 64,
  max_bytes = 64 * FLIGHT_TILE_BYTES,
  concurrency = 4,
  max_pending = 256,
  max_availability = 1024,
  availability_ttl_ms = 5000,
  now = Date.now,
} = {}) {
  if (
    typeof load_tile !== "function" ||
    typeof load_availability !== "function"
  )
    throw new TypeError("Flight tile transports required");
  for (const value of [
    max_tiles,
    max_bytes,
    concurrency,
    max_pending,
    max_availability,
    availability_ttl_ms,
  ])
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new RangeError("Invalid flight cache limit");
  if (max_bytes < FLIGHT_TILE_BYTES)
    throw new RangeError("Flight cache must fit at least one tile");
  const tiles = new Map(),
    pinned = new Set(),
    available = new Map(),
    pending = new Map();
  let source_id = null,
    active = 0,
    destroyed = false;
  const touch = (map, key, value) => {
    map.delete(key);
    map.set(key, value);
    return value;
  };
  const remember = (code, value) => {
    touch(available, code, { value, expires: now() + availability_ttl_ms });
    while (available.size > max_availability)
      available.delete(available.keys().next().value);
  };
  const known = (code) => {
    if (tiles.has(code)) return true;
    const record = available.get(code);
    if (!record) return undefined;
    if (record.expires <= now()) {
      available.delete(code);
      return undefined;
    }
    touch(available, code, record);
    return record.value;
  };
  const settle = (entry, error, value) => {
    for (const waiter of entry.waiters) {
      waiter.signal?.removeEventListener("abort", waiter.cancel);
      if (error) waiter.reject(error);
      else waiter.resolve(value);
    }
    entry.waiters.clear();
  };
  const cancel = (entry) => {
    entry.cancelled = true;
    if (pending.get(entry.key) === entry) pending.delete(entry.key);
    entry.controller.abort();
    settle(entry, abort_error());
  };
  const accept_source = (identity, entry) => {
    if (typeof identity !== "string" || !identity)
      throw cache_error("INVALID_TILE_SOURCE");
    if (source_id !== null && source_id !== identity) {
      tiles.clear();
      pinned.clear();
      available.clear();
      for (const other of pending.values()) if (other !== entry) cancel(other);
      source_id = identity;
      throw cache_error("TILE_SOURCE_CHANGED");
    }
    source_id = identity;
  };
  const decode = (response, code) => {
    if (response.schema_version !== 1 || response.short_code !== code)
      throw cache_error("INVALID_TILE_RESPONSE");
    validate_tile_data(response.tile_data);
    const values = new Float64Array(TILE_EDGE * TILE_EDGE * 2);
    for (let y = 0; y < TILE_EDGE; y++)
      for (let x = 0; x < TILE_EDGE; x++) {
        const pair = response.tile_data[x][y],
          index = (y * TILE_EDGE + x) * 2;
        values[index] = pair === null ? NaN : pair[0];
        values[index + 1] = pair === null ? NaN : pair[1];
      }
    return Object.freeze({
      short_code: code,
      source_id: response.source_id,
      bounds: Object.freeze(tile_bounds(code)),
      values,
    });
  };
  const execute = async (entry) => {
    try {
      let response;
      try {
        response = await (entry.kind === "tile"
          ? load_tile(entry.codes[0], { signal: entry.controller.signal })
          : load_availability(entry.codes, {
              signal: entry.controller.signal,
            }));
      } catch (error) {
        if (
          !entry.cancelled &&
          entry.kind === "tile" &&
          error.status === 404 &&
          error.code === "TILE_NOT_INDEXED"
        ) {
          accept_source(error.source_id, entry);
          remember(entry.codes[0], false);
          settle(entry, null, null);
          return;
        }
        throw error;
      }
      if (entry.cancelled) return;
      if (response?.schema_version !== 1)
        throw cache_error("INVALID_TILE_RESPONSE");
      accept_source(response.source_id, entry);
      if (entry.kind === "tile") {
        const code = entry.codes[0],
          tile = decode(response, code);
        while (
          !tiles.has(code) &&
          (tiles.size >= max_tiles ||
            (tiles.size + 1) * FLIGHT_TILE_BYTES > max_bytes)
        ) {
          const victim = [...tiles.keys()].find((key) => !pinned.has(key));
          if (victim === undefined)
            throw cache_error("FLIGHT_TILE_CACHE_BUDGET");
          tiles.delete(victim);
        }
        touch(tiles, code, tile);
        remember(code, true);
        settle(entry, null, tile);
      } else {
        const result = {};
        for (const code of entry.codes) {
          const value = response.availability?.[code];
          if (typeof value !== "boolean")
            throw cache_error("INVALID_TILE_AVAILABILITY");
          result[code] = value;
        }
        for (const code of entry.codes) remember(code, result[code]);
        settle(entry, null, result);
      }
    } catch (error) {
      if (!entry.cancelled) settle(entry, error);
    } finally {
      if (pending.get(entry.key) === entry) pending.delete(entry.key);
      active--;
      pump();
    }
  };
  const pump = () => {
    if (destroyed) return;
    for (const entry of pending.values()) {
      if (active >= concurrency) break;
      if (entry.started) continue;
      entry.started = true;
      active++;
      void execute(entry);
    }
  };
  const request = (kind, codes, signal) => {
    if (destroyed) return Promise.reject(cache_error("FLIGHT_CACHE_DESTROYED"));
    if (signal?.aborted) return Promise.reject(abort_error());
    const key = `${kind}:${codes.join(",")}`;
    let entry = pending.get(key);
    if (!entry) {
      if (pending.size >= max_pending)
        return Promise.reject(cache_error("FLIGHT_TILE_QUEUE_FULL"));
      entry = {
        key,
        kind,
        codes,
        waiters: new Set(),
        controller: new AbortController(),
        started: false,
        cancelled: false,
      };
      pending.set(key, entry);
    }
    const promise = new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal, cancel: null };
      waiter.cancel = () => {
        entry.waiters.delete(waiter);
        signal.removeEventListener("abort", waiter.cancel);
        reject(abort_error());
        if (!entry.waiters.size) cancel(entry);
        pump();
      };
      entry.waiters.add(waiter);
      signal?.addEventListener("abort", waiter.cancel, { once: true });
    });
    pump();
    return promise;
  };
  const usable = (signal) => {
    if (destroyed) throw cache_error("FLIGHT_CACHE_DESTROYED");
    if (signal?.aborted) throw abort_error();
  };
  const clear = () => {
    tiles.clear();
    pinned.clear();
    available.clear();
    source_id = null;
    for (const entry of pending.values()) cancel(entry);
  };
  return {
    pin(codes) {
      const next = codes.map(validate_tile_code);
      pinned.clear();
      for (const code of next) if (tiles.has(code)) pinned.add(code);
    },
    peek(code) {
      validate_tile_code(code);
      const tile = tiles.get(code);
      return tile ? touch(tiles, code, tile) : null;
    },
    async load(code, { signal } = {}) {
      validate_tile_code(code);
      usable(signal);
      const tile = tiles.get(code);
      if (tile) return touch(tiles, code, tile);
      if (known(code) === false) return null;
      if (
        (tiles.size >= max_tiles ||
          (tiles.size + 1) * FLIGHT_TILE_BYTES > max_bytes) &&
        pinned.size === tiles.size
      )
        throw cache_error("FLIGHT_TILE_CACHE_BUDGET");
      return request("tile", [code], signal);
    },
    async availability(codes, { signal } = {}) {
      usable(signal);
      if (!Array.isArray(codes) || codes.length > 256)
        throw new RangeError("At most 256 availability codes allowed");
      const unique = [...new Set(codes.map(validate_tile_code))].sort();
      const result = {},
        missing = [];
      for (const code of unique) {
        const value = known(code);
        if (value === undefined) missing.push(code);
        else result[code] = value;
      }
      if (missing.length)
        Object.assign(result, await request("availability", missing, signal));
      return result;
    },
    retain(codes) {
      const wanted = new Set(codes.map(validate_tile_code));
      for (const entry of pending.values())
        if (!entry.codes.some((code) => wanted.has(code))) cancel(entry);
      pump();
    },
    clear,
    destroy() {
      destroyed = true;
      clear();
    },
    get_stats() {
      return {
        source_id,
        tiles: tiles.size,
        pinned: pinned.size,
        bytes: tiles.size * FLIGHT_TILE_BYTES,
        availability: available.size,
        pending: pending.size,
        active,
        destroyed,
      };
    },
  };
}
