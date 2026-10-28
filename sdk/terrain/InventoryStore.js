import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { decode_terrain_mesh } from "./Cache.js";
import {
  initialize_mesh_storage,
  MESH_DIRECTORY,
  MESH_LAYOUT,
  mesh_relative_path,
} from "./Paths.js";
import { InventoryJournal } from "./InventoryJournal.js";

const signature = (stat) =>
  [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs]
    .map(String)
    .join(":");

/** Single service owner serializes all persistence; readers use inventory directly. */
export class MeshInventoryStore {
  constructor({
    root = MESH_DIRECTORY,
    layout = MESH_LAYOUT,
    source_identity,
  }) {
    this.root = path.resolve(root);
    this.layout = layout;
    this.journal = new InventoryJournal(this.root, source_identity);
    this.chain = Promise.resolve();
  }
  get inventory() {
    return this.journal.inventory;
  }
  enqueue(operation) {
    const result = this.chain.then(operation);
    this.chain = result.catch(() => {});
    return result;
  }
  async initialize() {
    await initialize_mesh_storage({ root: this.root, layout: this.layout });
    if (await this.journal.load()) await this.recover_pending();
    else await this.reconcile({ force: true });
    return this;
  }
  begin(short_code) {
    mesh_relative_path(short_code, this.layout);
    return this.enqueue(async () => {
      if (!this.journal.pending.has(short_code))
        await this.journal.append({ type: "begin", short_code });
    });
  }
  observe(short_code, { complete = false, force = false } = {}) {
    mesh_relative_path(short_code, this.layout);
    return this.enqueue(() => this.observe_file(short_code, complete, force));
  }
  async observe_file(short_code, complete = false, force = true) {
    const filename = path.join(
      this.root,
      mesh_relative_path(short_code, this.layout),
    );
    let record = null,
      stamp = null;
    try {
      // Atomic replacement can race retrieval observations; accept only a stable read.
      for (let attempt = 0; attempt < 3; attempt++) {
        const before = await fs.lstat(filename, { bigint: true });
        if (!before.isFile())
          throw Object.assign(new Error("Mesh path is not a regular file"), {
            code: "EISDIR",
          });
        stamp = signature(before);
        if (
          !force &&
          stamp === this.journal.signatures.get(short_code) &&
          !(complete && this.journal.pending.has(short_code))
        )
          return;
        const compressed = await fs.readFile(filename);
        const after = await fs.lstat(filename, { bigint: true });
        if (stamp !== signature(after)) {
          stamp = null;
          continue;
        }
        record = {
          short_code,
          namespace: null,
          compressed_bytes: compressed.length,
          sha256: createHash("sha256").update(compressed).digest("hex"),
          status: "invalid",
        };
        try {
          const { metadata } = decode_terrain_mesh(compressed, false);
          if (
            metadata.short_code === short_code &&
            /^[a-f0-9]{32}$/.test(metadata.namespace || "")
          )
            record = {
              ...record,
              namespace: metadata.namespace,
              status: "ready",
            };
        } catch {
          /* Corrupt/incompatible bytes stay invalid and cannot paint as ready. */
        }
        break;
      }
      if (!stamp) throw new Error("Mesh changed during inventory read");
    } catch (error) {
      if (error.code === "ENOENT") {
        record = null;
        stamp = null;
      } else if (["EACCES", "EPERM", "EISDIR"].includes(error.code)) {
        record = {
          short_code,
          namespace: null,
          compressed_bytes: 0,
          sha256: null,
          status: "invalid",
        };
        stamp = null;
      } else throw error;
    }
    const current = this.inventory.get(short_code);
    const existing = current && {
      short_code,
      namespace: current.namespace,
      compressed_bytes: current.compressed_bytes,
      sha256: current.sha256,
      status: current.status === "invalid" ? "invalid" : "ready",
    };
    if (
      JSON.stringify(existing || null) === JSON.stringify(record) &&
      stamp === (this.journal.signatures.get(short_code) || null) &&
      !(complete && this.journal.pending.has(short_code))
    )
      return;
    await this.journal.append({
      type: "observe",
      short_code,
      record,
      signature: stamp,
      complete,
    });
  }
  recover_pending() {
    return this.enqueue(async () => {
      for (const code of [...this.journal.pending])
        await this.observe_file(code, true);
      await this.journal.checkpoint();
    });
  }
  reconcile({ force = false } = {}) {
    return this.enqueue(async () => {
      const seen = new Set();
      const visit = async (directory) => {
        for (const item of await fs.readdir(directory, {
          withFileTypes: true,
        })) {
          if (item.isSymbolicLink()) continue;
          const filename = path.join(directory, item.name);
          if (item.isDirectory()) {
            if (
              /^[0-3]{4}$/.test(item.name) ||
              (directory === this.root && /^L\d{2}$/.test(item.name))
            )
              await visit(filename);
          } else if (item.isFile() && /^[0-3]{2,34}\.gz$/.test(item.name)) {
            const code = item.name.slice(0, -3);
            if (
              filename !==
              path.join(this.root, mesh_relative_path(code, this.layout))
            )
              continue;
            seen.add(code);
            if (!this.journal.pending.has(code))
              await this.observe_file(code, false, force);
          }
        }
      };
      await visit(this.root);
      for (const record of this.inventory.snapshot().records) {
        if (
          !seen.has(record.short_code) &&
          !this.journal.pending.has(record.short_code)
        )
          await this.observe_file(record.short_code);
      }
      await this.journal.checkpoint();
      return {
        ...this.inventory.summary(),
        pending: this.journal.pending.size,
      };
    });
  }
}
