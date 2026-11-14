import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { local_topology } from "./instrument_transfer/local_topology.js";
import { load_instrument_catalog } from "../servers/fracto-ui/src/pages/games/music/MidiInstrumentCatalog.js";
import { events_from_midi } from "../servers/fracto-ui/src/pages/games/music/MidiEvents.js";
import { ORIGINAL_INSTRUMENT } from "../servers/fracto-ui/src/pages/games/music/MidiInstruments.js";
import { effective_instrument } from "../servers/fracto-ui/src/pages/games/music/MidiInstrumentChoices.js";
import { transfer_receipt_verified } from "../servers/fracto-ui/src/pages/admin/InstrumentTransferModel.js";
import { read_pcm_wav } from "../servers/fracto-asset-server/instruments/playback-assets.js";
import { staging_path } from "../servers/fracto-asset-server/instruments/transfer_staging.js";
import { transfer_hash } from "../utils/instrument_transfer.js";

const { values } = parseArgs({
  options: {
    source: { type: "string" },
    midi: { type: "string" },
    output: {
      type: "string",
      default: "logs/instrument_transfer_verification.json",
    },
  },
});
assert.ok(
  values.source && values.midi,
  "Usage: node scripts/verify_instrument_transfer.js --source <instrument directory> --midi <MIDI file> [--output <report.json>]",
);
const source = path.resolve(values.source),
  output = path.resolve(values.output);
assert.ok(
  !output.startsWith(source + path.sep),
  "Report must be outside the source library",
);
const source_catalog = await fs.readFile(path.join(source, "catalog.json"));
const song = events_from_midi(new Uint8Array(await fs.readFile(values.midi)));
const scratch = await fs.mkdtemp(
  path.join(os.tmpdir(), "fracto-transfer-acceptance-"),
);
const receiver = path.join(scratch, "receiver");
await fs.mkdir(receiver);
const report = {
  started_at: new Date().toISOString(),
  midi: path.basename(values.midi),
  source_catalog_sha256: transfer_hash(source_catalog),
  checks: [],
};
let topology;
const record = (check, evidence = {}) => {
  report.checks.push({ check, ...evidence });
  console.log(JSON.stringify({ check, ...evidence }));
};
async function settle(id, preview = false) {
  const deadline = Date.now() + 1800000;
  let next_log = 0;
  for (;;) {
    const job = await topology.request(`/jobs/${id}`);
    if (
      ![
        "previewing",
        "transferring",
        "validating",
        "publishing",
        "verifying",
      ].includes(job.state)
    ) {
      assert.equal(
        job.state,
        preview ? "ready" : "completed",
        JSON.stringify(job.error),
      );
      return job;
    }
    if (Date.now() >= next_log) {
      console.log(JSON.stringify({ phase: job.phase, progress: job.progress }));
      next_log = Date.now() + 10000;
    }
    assert.ok(Date.now() < deadline, "Local acceptance deadline exceeded");
    await delay(250);
  }
}
async function preview() {
  const start = await topology.request("/jobs", {
    protocol_version: 1,
    peer: "http://local-receiver",
  });
  return settle(start.id, true);
}
async function apply(job) {
  await topology.request(`/jobs/${job.id}/apply`, {
    protocol_version: 1,
    plan_sha256: job.plan_sha256,
  });
  const completed = await settle(job.id);
  assert.equal(transfer_receipt_verified(completed), true);
  return completed;
}
async function check_midi() {
  const loaded = await load_instrument_catalog(
    `${topology.target.base}/instruments`,
  );
  const tracks = song.tracks
    .map((track, index) => {
      const notes = song.notes.filter((note) => note.track === index);
      if (!notes.length) return null;
      assert.equal(
        loaded.registry.can_assign(notes, ORIGINAL_INSTRUMENT),
        true,
        `Track ${index} original assignment unavailable`,
      );
      const name = effective_instrument(
        notes,
        ORIGINAL_INSTRUMENT,
        loaded.registry,
        (key) => key,
      );
      return {
        track: index,
        notes: notes.length,
        programs_zero_based: [...new Set(notes.map((note) => note.program))],
        instrument: name,
      };
    })
    .filter(Boolean);
  assert.ok(tracks.length, "Expected playable MIDI tracks");
  const samples = new Map(
    song.notes.map((note) => {
      const sample = loaded.registry.resolve(note, ORIGINAL_INSTRUMENT);
      return [sample.url, sample];
    }),
  );
  let nonzero_frames = 0;
  for (const [url, sample] of samples) {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer()),
      wav = read_pcm_wav(bytes);
    assert.equal(transfer_hash(bytes), new URL(url).searchParams.get("v"));
    const first = Math.round(sample.offset_seconds * wav.sample_rate),
      last = first + Math.round(sample.duration_seconds * wav.sample_rate);
    assert.ok(first >= 0 && last <= wav.frames);
    nonzero_frames += wav.pcm
      .subarray(first, last)
      .filter((value) => value !== 0).length;
  }
  assert.ok(nonzero_frames > 0);
  return {
    tracks,
    samples_read: samples.size,
    nonzero_frames,
    available_instruments: loaded.catalog.instruments.filter(
      (item) => item.available,
    ).length,
  };
}
try {
  topology = await local_topology(source, receiver);
  const peers = await topology.request("/peers");
  assert.equal(peers.protocol_version, 1);
  const initial = await preview();
  assert.equal(initial.summary.target_catalog_sha256, null);
  assert.equal(initial.summary.missing_files, initial.summary.package_files);
  record("empty_receiver_preview", { summary: initial.summary });
  const completed = await apply(initial);
  record("whole_library_published", {
    receipt: completed.receipt,
    bytes_transferred: completed.progress.bytes_transferred,
  });
  record("bach_original_assignment_and_wav", await check_midi());
  const session_id = topology.jobs.get(completed.id).session_id;
  await topology.target.restart();
  const recovered = await topology.receipt(session_id);
  assert.equal(recovered.state, "completed");
  assert.deepEqual(recovered.receipt, completed.receipt);
  record("receiver_restart_preserved_receipt", { receipt: recovered.receipt });
  record("restart_preserved_bach_assignment_and_wav", await check_midi());
  const identical = await preview();
  assert.equal(identical.summary.missing_files, 0);
  assert.equal(identical.summary.conflict_files, 0);
  await topology.request(`/jobs/${identical.id}/cancel`, {
    protocol_version: 1,
  });
  record("identical_library_preview", {
    matching_files: identical.summary.matching_files,
    missing_bytes: identical.summary.missing_bytes,
  });
  const manifest = topology.jobs.get(completed.id).manifest;
  const file = manifest.files.find(
    (item) =>
      item.kind === "playback" && item.relative_path.includes("guitar-nylon"),
  );
  assert.ok(file, "Expected the Bach guitar playback dependency");
  await fs.unlink(path.join(receiver, file.relative_path));
  await fs.unlink(
    path.join(receiver, staging_path(completed.manifest_sha256, file)),
  );
  const repair = await preview();
  assert.equal(repair.summary.missing_files, 1);
  assert.equal(repair.summary.missing_bytes, file.bytes);
  await apply(repair);
  record("same_catalog_missing_guitar_repaired", {
    bytes_transferred: file.bytes,
  });
  record("repaired_bach_assignment_and_wav", await check_midi());
  assert.deepEqual(
    await fs.readFile(path.join(source, "catalog.json")),
    source_catalog,
  );
  report.result = "passed";
} catch (error) {
  report.result = "failed";
  report.error = { message: error.message, code: error.code };
  process.exitCode = 1;
} finally {
  if (topology) {
    for (const job of topology.jobs.jobs.values())
      if (
        [
          "previewing",
          "ready",
          "transferring",
          "validating",
          "publishing",
          "verifying",
        ].includes(job.state)
      )
        await topology.jobs.cancel(job).catch(() => {});
    await topology.close();
  }
  assert.equal(path.dirname(scratch), path.resolve(os.tmpdir()));
  assert.ok(path.basename(scratch).startsWith("fracto-transfer-acceptance-"));
  await fs.rm(scratch, { recursive: true, force: true });
  report.finished_at = new Date().toISOString();
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, output }));
}
