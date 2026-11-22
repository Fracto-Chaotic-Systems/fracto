import {
  catalog_libraries,
  MAX_CATALOG_BYTES,
  MAX_INSTRUMENTS,
} from "./MidiCatalogLibraries.js";
import {
  create_instrument_registry,
  GRANDB_PROVIDER,
} from "./MidiInstruments.js";
import { MidiPlaybackError } from "./MidiPianoSamples.js";
import { drum_kit_provider } from "./MidiDrumKit.js";
const fail = () => {
  throw new MidiPlaybackError(
    "catalog_unavailable",
    "The instrument catalog is invalid or unavailable.",
  );
};
const hash = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const integer = (value, min, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && value >= min && value <= max;
const layers = ["p", "mp", "mf", "f", "ff"];
const deep_freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deep_freeze);
    Object.freeze(value);
  }
  return value;
};

// The service may be mounted at /api/asset in production. Root-relative URLs
// returned by its router are relative to that service, not to the UI origin.
export function instrument_audio_url(value, catalog_url) {
  if (typeof value !== "string") fail();
  const base = new URL(catalog_url);
  let url;
  if (value.startsWith("/instruments/")) {
    const prefix = base.pathname.replace(/\/instruments\/?$/, "");
    url = new URL(`${prefix}${value}`, base.origin);
  } else url = new URL(value, base);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  )
    fail();
  return url.href;
}

function provider_from_catalog(item, revision, catalog_url) {
  const by_layer = new Map(),
    seen_ids = new Set(),
    seen_urls = new Set();
  if (
    !Array.isArray(item.playback_assets) ||
    !item.playback_assets.length ||
    item.playback_assets.length > 256 ||
    !Array.isArray(item.recordings) ||
    !item.recordings.length ||
    !Array.isArray(item.midi_programs) ||
    item.midi_programs.some((program) => !integer(program, 0, 127))
  )
    fail();
  const recordings = new Map(
    item.recordings.map((recording) => [recording.id, recording]),
  );
  if (recordings.size !== item.recordings.length) fail();
  for (const asset of item.playback_assets) {
    const recording = recordings.get(asset.recording_id);
    const layer = asset.velocity_layer ?? null;
    if (
      !recording ||
      recording.velocity_layer !== layer ||
      (layer !== null && !layers.includes(layer)) ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(asset.id) ||
      seen_ids.has(asset.id) ||
      !hash(asset.sha256) ||
      asset.available !== true ||
      asset.method_version !== "mono-octave-pcm16-v1" ||
      asset.encoding !== "pcm_s16le" ||
      asset.mime_type !== "audio/wav" ||
      asset.channels !== 1 ||
      !integer(asset.sample_rate, 8000, 192000) ||
      !integer(asset.frames, 1) ||
      !integer(asset.bytes, 44) ||
      asset.bytes !== 44 + asset.frames * 2 ||
      !Array.isArray(asset.notes) ||
      !asset.notes.length ||
      asset.notes.length > 12 ||
      !Number.isFinite(asset.duration_seconds) ||
      Math.abs(asset.duration_seconds - asset.frames / asset.sample_rate) >
        1e-8 ||
      asset.decoded_bytes_at_48000 !==
        Math.ceil((asset.frames * 48000) / asset.sample_rate) * 4 ||
      asset.decoded_bytes_at_48000 > 48 * 1024 * 1024
    )
      fail();
    const url = instrument_audio_url(asset.url, catalog_url);
    if (
      new URL(url).searchParams.get("v") !== asset.sha256 ||
      !new URL(url).pathname.endsWith(
        `/instruments/${item.id}/audio/${asset.id}`,
      ) ||
      seen_urls.has(url)
    )
      fail();
    seen_ids.add(asset.id);
    seen_urls.add(url);
    if (!by_layer.has(layer)) by_layer.set(layer, new Map());
    const notes = by_layer.get(layer);
    let cursor = 0,
      previous_pitch = -1;
    const octave = Math.floor(asset.notes[0].midi_pitch / 12);
    for (const note of asset.notes) {
      if (
        !integer(note.midi_pitch, 0, 127) ||
        note.midi_pitch <= previous_pitch ||
        notes.has(note.midi_pitch) ||
        Math.floor(note.midi_pitch / 12) !== octave ||
        !integer(note.offset_frames, 0) ||
        !integer(note.frames, 1) ||
        note.offset_frames !==
          cursor + (cursor ? Math.round(0.05 * asset.sample_rate) : 0) ||
        note.offset_frames + note.frames > asset.frames ||
        !integer(
          note.onset_frame,
          note.offset_frames,
          note.offset_frames + note.frames - 1,
        ) ||
        !Number.isFinite(note.offset_seconds) ||
        Math.abs(note.offset_seconds - note.offset_frames / asset.sample_rate) >
          1e-8 ||
        !Number.isFinite(note.duration_seconds) ||
        Math.abs(note.duration_seconds - note.frames / asset.sample_rate) > 1e-8
      )
        fail();
      notes.set(note.midi_pitch, {
        url,
        sha256: asset.sha256,
        encoded_bytes: asset.bytes,
        asset_frames: asset.frames,
        asset_sample_rate: asset.sample_rate,
        asset_channels: 1,
        offset_seconds: note.offset_seconds,
        duration_seconds: note.duration_seconds,
        credentials: "include",
      });
      cursor = note.offset_frames + note.frames;
      previous_pitch = note.midi_pitch;
    }
    if (cursor !== asset.frames) fail();
  }
  const ordered = [...by_layer.keys()].sort(
    (a, b) => layers.indexOf(a) - layers.indexOf(b),
  );
  if (by_layer.has(null) && by_layer.size !== 1) fail();
  const choose = (note) =>
    ordered[
      Math.min(
        ordered.length - 1,
        Math.floor(((note.velocity - 1) * ordered.length) / 127),
      )
    ];
  const pitches = [
    ...new Set([...by_layer.values()].flatMap((notes) => [...notes.keys()])),
  ];
  return {
    id: `asset-${item.id}`,
    catalog_id: item.id,
    source_identity: JSON.stringify([...seen_urls]),
    name: item.name,
    version: revision,
    verified: true,
    programs: [...item.midi_programs],
    min_pitch: Math.min(...pitches),
    max_pitch: Math.max(...pitches),
    percussion: false,
    supports_note: (note) =>
      by_layer.get(choose(note))?.has(note.pitch) ?? false,
    sample: (note) => {
      const source = by_layer.get(choose(note))?.get(note.pitch);
      if (!source)
        throw new MidiPlaybackError(
          "instrument_unavailable",
          "No catalog sample supports this pitch and velocity.",
        );
      return {
        ...source,
        gain: (note.velocity / 127) * 0.5,
        pan: 0,
        release_seconds: 0.15,
      };
    },
  };
}

export function registry_from_catalog(
  catalog,
  catalog_url,
  { allow_prepared = false } = {},
) {
  if (
    catalog?.schema_version !== 1 ||
    !hash(catalog.revision) ||
    !integer(catalog.library_version, 1) ||
    !Array.isArray(catalog.instruments) ||
    catalog.instruments.length > MAX_INSTRUMENTS
  )
    fail();
  let metadata;
  try {
    metadata = catalog_libraries(catalog);
  } catch {
    fail();
  }
  const ids = new Set(),
    definitions = [GRANDB_PROVIDER];
  for (const item of catalog.instruments) {
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.name !== "string" ||
      !item.name ||
      item.name.length > 256 ||
      typeof item.enabled !== "boolean"
    )
      fail();
    ids.add(item.id);
    if (
      item.available &&
      (item.enabled || allow_prepared) &&
      ["assets_prepared", "playback_verified"].includes(
        item.verification_status,
      )
    )
      definitions.push({
        ...provider_from_catalog(item, catalog.revision, catalog_url),
        library_id: item.library_id ?? "legacy",
        instrument_key: item.instrument_key ?? item.id,
        library_name: metadata.libraries.find(
          (library) => library.id === (item.library_id ?? "legacy"),
        ).name,
      });
  }
  for (const kit of metadata.drum_kits) {
    if (
      kit.verification_status !== "playback_verified" ||
      !(kit.enabled || allow_prepared) ||
      !kit.available
    )
      continue;
    definitions.push({
      ...drum_kit_provider(kit, catalog.revision, (value) =>
        instrument_audio_url(value, catalog_url),
      ),
      library_name: metadata.libraries.find(
        (library) => library.id === kit.library_id,
      ).name,
    });
  }
  return create_instrument_registry(definitions, metadata);
}

async function bounded_catalog_json(response) {
  const declared = Number(response.headers?.get("content-length"));
  if (declared > MAX_CATALOG_BYTES) {
    await response.body?.cancel();
    fail();
  }
  if (!response.body?.getReader) {
    const value = await response.json();
    if (
      new TextEncoder().encode(JSON.stringify(value)).byteLength >
      MAX_CATALOG_BYTES
    )
      fail();
    return value;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0,
    text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CATALOG_BYTES) {
        await reader.cancel();
        fail();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function load_instrument_catalog(
  catalog_url,
  {
    signal,
    fetch_catalog = (...args) => fetch(...args),
    allow_prepared = false,
    timeout_ms = 8000,
  } = {},
) {
  const request = new AbortController();
  const abort = () => request.abort();
  if (signal?.aborted) request.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeout_ms);
  try {
    if (request.signal.aborted) fail();
    const response = await fetch_catalog(catalog_url, {
      credentials: "include",
      signal: request.signal,
    });
    if (!response.ok) fail();
    const catalog = await bounded_catalog_json(response);
    if (request.signal.aborted) fail();
    const registry = registry_from_catalog(
      catalog,
      response.url || catalog_url,
      { allow_prepared },
    );
    return { catalog: deep_freeze(catalog), registry };
  } catch (error) {
    if (error instanceof MidiPlaybackError) throw error;
    fail();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
