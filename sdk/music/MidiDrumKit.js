import { MidiPlaybackError } from "./MidiPianoSamples.js";

// Structural hit/velocity/bounds validation is shared with the asset server.
// URLs and availability are validated here at the HTTP catalog boundary.
export function drum_kit_provider(kit, revision, audio_url) {
  const notes = new Map(),
    urls = new Set();
  const fail = () => {
    throw new MidiPlaybackError(
      "catalog_unavailable",
      "Invalid drum kit audio assets.",
    );
  };
  for (const asset of kit.playback_assets) {
    const url = audio_url(asset.url),
      parsed = new URL(url);
    if (
      asset.available !== true ||
      urls.has(url) ||
      parsed.searchParams.get("v") !== asset.sha256 ||
      !parsed.pathname.endsWith(`/instruments/${kit.id}/audio/${asset.id}`)
    )
      fail();
    urls.add(url);
    for (const hit of asset.hits) {
      if (!notes.has(hit.midi_note)) notes.set(hit.midi_note, []);
      notes.get(hit.midi_note).push({ asset, hit, url });
    }
  }
  const find = (note) =>
    notes
      .get(note.pitch)
      ?.find(
        ({ hit }) =>
          Number.isInteger(note.velocity) &&
          hit.velocity_min <= note.velocity &&
          note.velocity <= hit.velocity_max,
      );
  const groups = new Map(
    kit.choke_groups.flatMap((group) =>
      group.midi_notes.map((pitch) => [pitch, group.source_exclusive_class]),
    ),
  );
  return {
    id: `asset-${kit.id}`,
    catalog_id: kit.id,
    library_id: kit.library_id,
    instrument_key: kit.kit_key,
    name: kit.name,
    source_identity: JSON.stringify([...urls]),
    version: revision,
    verified: true,
    programs: [kit.midi_program],
    percussion: true,
    min_pitch: Math.min(...notes.keys()),
    max_pitch: Math.max(...notes.keys()),
    supports_note: (note) => !!find(note),
    sample(note) {
      const entry = find(note);
      if (!entry)
        throw new MidiPlaybackError(
          "instrument_unavailable",
          "No verified hit supports this drum note and velocity.",
        );
      const { asset, hit, url } = entry;
      return {
        url,
        sha256: asset.sha256,
        encoded_bytes: asset.bytes,
        asset_frames: asset.frames,
        asset_sample_rate: asset.sample_rate,
        asset_channels: 1,
        credentials: "include",
        offset_seconds: hit.offset_seconds,
        duration_seconds: hit.duration_seconds,
        // The source render already includes velocity response. Scale only
        // within the chosen interval; do not apply velocity a second time.
        gain: note.velocity / hit.render_velocity,
        pan: 0,
        release_seconds: 0,
        playback_mode: "one-shot",
        choke_group: groups.get(note.pitch) ?? null,
      };
    },
  };
}
