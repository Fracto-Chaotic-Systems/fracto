import fs from "node:fs/promises";
import path from "node:path";
import { durable_replace } from "./DurableFile.js";
import { MeshInventory } from "./Inventory.js";

/** One service-owned writer. A failed append poisons further writes until reopen. */
export class InventoryJournal {
  constructor(root, source_identity) {
    this.root = root;
    this.source_identity = source_identity;
    this.snapshot_file = path.join(root, "inventory.json");
    this.journal_file = path.join(root, "inventory.journal.ndjson");
    this.inventory = new MeshInventory(source_identity);
    this.pending = new Set();
    this.signatures = new Map();
    this.sequence = 0;
  }

  apply(event) {
    if (event.type === "begin") {
      // Validate through the same shortcode path contract without mutating presence.
      this.inventory.has(event.short_code);
      this.pending.add(event.short_code);
      const current = this.inventory.get(event.short_code);
      if (current) this.inventory.upsert({ ...current, status: "invalid" });
    } else if (event.type === "observe") {
      if (event.record) this.inventory.upsert(event.record);
      else this.inventory.remove(event.short_code);
      if (event.signature)
        this.signatures.set(event.short_code, event.signature);
      else this.signatures.delete(event.short_code);
      if (event.complete) this.pending.delete(event.short_code);
    } else throw new Error("Invalid mesh inventory event");
  }

  async load() {
    let snapshot;
    try {
      snapshot = JSON.parse(await fs.readFile(this.snapshot_file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return false;
      return false;
    }
    try {
      if (
        snapshot.schema_version !== 1 ||
        !Number.isSafeInteger(snapshot.sequence) ||
        snapshot.sequence < 0 ||
        !Array.isArray(snapshot.pending) ||
        !Array.isArray(snapshot.signatures)
      )
        throw new Error("Invalid snapshot");
      this.inventory = MeshInventory.restore(
        this.source_identity,
        snapshot.inventory,
      );
      this.sequence = snapshot.sequence;
      this.pending = new Set(snapshot.pending);
      for (const code of this.pending) this.inventory.has(code);
      this.signatures = new Map(snapshot.signatures);
      let journal = "";
      try {
        journal = await fs.readFile(this.journal_file, "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      for (const line of journal.split("\n")) {
        if (!line) continue;
        const event = JSON.parse(line);
        if (!Number.isSafeInteger(event.sequence) || event.sequence < 1)
          throw new Error("Invalid sequence");
        if (event.sequence <= snapshot.sequence) continue; // snapshot published before journal truncation
        if (event.sequence !== this.sequence + 1)
          throw new Error("Mesh journal sequence gap");
        this.apply(event);
        this.sequence = event.sequence;
      }
      return true;
    } catch {
      // Preserve any validated prefix as a baseline for monotonic revisions;
      // a forced disk reconciliation replaces every observation before serving.
      this.pending.clear();
      this.signatures.clear();
      return false;
    }
  }

  async append(event) {
    if (this.failure) throw this.failure;
    const next = { ...event, sequence: this.sequence + 1 };
    let handle;
    try {
      handle = await fs.open(this.journal_file, "a");
      await handle.writeFile(JSON.stringify(next) + "\n");
      await handle.sync();
      await handle.close();
      handle = null;
    } catch (error) {
      this.failure = error;
      throw error;
    } finally {
      await handle?.close().catch(() => {});
    }
    this.apply(next);
    this.sequence = next.sequence;
  }

  async checkpoint() {
    if (this.failure) throw this.failure;
    await durable_replace(
      this.snapshot_file,
      JSON.stringify({
        schema_version: 1,
        sequence: this.sequence,
        inventory: this.inventory.snapshot(),
        pending: [...this.pending],
        signatures: [...this.signatures],
      }) + "\n",
    );
    await durable_replace(this.journal_file, "");
  }
}
