import FractoUtil from "../FractoUtil.js";
import { terrain_namespace } from "./Cache.js";

const validate_code = (code) => {
  if (typeof code !== "string" || !/^[0-3]{2,34}$/.test(code))
    throw new Error("Invalid mesh short code");
};
const lower_bound = (items, value, key) => {
  let lo = 0,
    hi = items.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (key(items[mid]) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/** In-memory observations of validated files; never infers presence from tiles. */
export class MeshInventory {
  #records = new Map();
  #levels = new Map();
  #spatial = new Map();
  #namespace;
  #revision = 0;

  constructor(source_identity) {
    if (
      !source_identity ||
      typeof source_identity !== "object" ||
      Array.isArray(source_identity)
    )
      throw new Error("Mesh inventory requires a source identity");
    this.#namespace = terrain_namespace(source_identity);
  }

  get revision() {
    return this.#revision;
  }
  get namespace() {
    return this.#namespace;
  }

  /** Raw validation states, preserving identity-derived stale status on reload. */
  snapshot() {
    return {
      revision: this.#revision,
      records: [...this.#records.values()].map((record) => ({
        short_code: record.short_code,
        namespace: record.namespace,
        compressed_bytes: record.compressed_bytes,
        sha256: record.sha256,
        status: record.status,
      })),
    };
  }

  static restore(source_identity, snapshot) {
    if (
      !Array.isArray(snapshot?.records) ||
      !Number.isSafeInteger(snapshot.revision) ||
      snapshot.revision < snapshot.records.length
    )
      throw new Error("Invalid mesh inventory snapshot");
    const inventory = new MeshInventory(source_identity);
    for (const record of snapshot.records) {
      if (!inventory.upsert(record))
        throw new Error("Duplicate mesh inventory record");
    }
    if (inventory.#records.size !== snapshot.records.length)
      throw new Error("Duplicate mesh inventory record");
    inventory.#revision = snapshot.revision;
    return inventory;
  }

  #status(record) {
    return record.status === "invalid"
      ? "invalid"
      : record.namespace === this.#namespace
        ? "ready"
        : "stale";
  }

  #copy(record) {
    return {
      ...record,
      bounds: { ...record.bounds },
      status: this.#status(record),
    };
  }

  /** Caller must validate the file first. Unknown/corrupt files use invalid. */
  upsert({
    short_code,
    namespace = null,
    compressed_bytes,
    sha256 = null,
    status = "ready",
  }) {
    validate_code(short_code);
    if (
      !["ready", "invalid"].includes(status) ||
      !Number.isSafeInteger(compressed_bytes) ||
      compressed_bytes < 0 ||
      (namespace !== null &&
        (typeof namespace !== "string" || !/^[a-f0-9]{32}$/.test(namespace))) ||
      (sha256 !== null &&
        (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256))) ||
      (status === "ready" && (!namespace || !sha256 || compressed_bytes === 0))
    )
      throw new Error("Invalid mesh inventory record");
    const level = short_code.length;
    const record = {
      short_code,
      level,
      namespace,
      compressed_bytes,
      sha256,
      status,
      bounds: FractoUtil.bounds_from_short_code(short_code),
    };
    if (
      JSON.stringify(this.#records.get(short_code)) === JSON.stringify(record)
    )
      return false;
    this.#records.set(short_code, record);
    if (!this.#levels.has(level)) this.#levels.set(level, new Map());
    const columns = this.#levels.get(level),
      left = record.bounds.left;
    if (!columns.has(left)) columns.set(left, new Map());
    columns.get(left).set(short_code, record);
    this.#spatial.delete(level);
    this.#revision++;
    return true;
  }

  /** Presence is an inventory observation; has_ready additionally checks identity. */
  has(short_code) {
    validate_code(short_code);
    return this.#records.has(short_code);
  }
  has_ready(short_code) {
    validate_code(short_code);
    const record = this.#records.get(short_code);
    return Boolean(record && this.#status(record) === "ready");
  }
  get(short_code) {
    validate_code(short_code);
    const record = this.#records.get(short_code);
    return record ? this.#copy(record) : null;
  }

  remove(short_code) {
    validate_code(short_code);
    const record = this.#records.get(short_code);
    if (!record) return false;
    this.#records.delete(short_code);
    const columns = this.#levels.get(record.level),
      column = columns.get(record.bounds.left);
    column.delete(short_code);
    if (!column.size) columns.delete(record.bounds.left);
    if (!columns.size) this.#levels.delete(record.level);
    this.#spatial.delete(record.level);
    this.#revision++;
    return true;
  }

  #columns(level) {
    if (!this.#spatial.has(level)) {
      const columns = [...(this.#levels.get(level) || [])]
        .map(([left, records]) => ({
          left,
          tiles: [...records.values()].sort(
            (a, b) => a.bounds.bottom - b.bounds.bottom,
          ),
        }))
        .sort((a, b) => a.left - b.left);
      this.#spatial.set(level, columns);
    }
    return this.#spatial.get(level);
  }

  /** Returns canonical records once; upper-half meshes also cover reflected views. */
  tiles_in_scope(
    level,
    focal_point,
    scope,
    aspect_ratio = 1,
    { include_unavailable = false, mirror_y = true, limit = Infinity } = {},
  ) {
    if (
      !Number.isSafeInteger(level) ||
      level < 2 ||
      level > 34 ||
      !Number.isFinite(focal_point?.x) ||
      !Number.isFinite(focal_point?.y) ||
      !Number.isFinite(scope) ||
      scope <= 0 ||
      !Number.isFinite(aspect_ratio) ||
      aspect_ratio <= 0 ||
      (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 0))
    )
      throw new Error("Invalid mesh inventory viewport");
    const left = focal_point.x - scope / 2,
      right = focal_point.x + scope / 2;
    const bottom = focal_point.y - (scope * aspect_ratio) / 2,
      top = focal_point.y + (scope * aspect_ratio) / 2;
    if (![left, right, bottom, top].every(Number.isFinite))
      throw new Error("Invalid mesh inventory viewport");
    const columns = this.#columns(level),
      size = 2 ** (2 - level),
      found = new Map();
    const visit = (min_y, max_y, reflected) => {
      for (
        let c = lower_bound(columns, left - size, (col) => col.left);
        c < columns.length && columns[c].left < right;
        c++
      ) {
        const column = columns[c];
        if (column.left + size <= left) continue;
        for (
          let r = lower_bound(
            column.tiles,
            min_y - size,
            (tile) => tile.bounds.bottom,
          );
          r < column.tiles.length && column.tiles[r].bounds.bottom < max_y;
          r++
        ) {
          const tile = column.tiles[r];
          if (tile.bounds.top <= min_y || (reflected && tile.bounds.bottom < 0))
            continue;
          if (include_unavailable || this.#status(tile) === "ready") {
            if (!found.has(tile.short_code) && found.size >= limit)
              throw Object.assign(new Error("Mesh query limit exceeded"), {
                code: "MESH_QUERY_LIMIT",
              });
            found.set(tile.short_code, tile);
          }
        }
      }
    };
    visit(bottom, top, false);
    if (mirror_y) visit(-top, -bottom, true);
    return [...found.values()]
      .sort(
        (a, b) => a.bounds.left - b.bounds.left || b.bounds.top - a.bounds.top,
      )
      .map((record) => this.#copy(record));
  }

  summary() {
    const counts = () => ({
      total: 0,
      ready: 0,
      stale: 0,
      invalid: 0,
      compressed_bytes: 0,
    });
    const result = {
      revision: this.#revision,
      namespace: this.#namespace,
      ...counts(),
      levels: [],
    };
    const levels = new Map();
    for (const record of this.#records.values()) {
      if (!levels.has(record.level))
        levels.set(record.level, { level: record.level, ...counts() });
      for (const target of [result, levels.get(record.level)]) {
        target.total++;
        target[this.#status(record)]++;
        target.compressed_bytes += record.compressed_bytes;
      }
    }
    result.levels = [...levels.values()].sort((a, b) => a.level - b.level);
    return result;
  }
}
