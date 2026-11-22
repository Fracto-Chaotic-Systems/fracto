export const PIANO_SAMPLE_ROOT =
  "https://mikehallstudio.s3.amazonaws.com/tone-gallery/instruments/GrandB";
export const PIANO_MIN_PITCH = 21;
export const PIANO_MAX_PITCH = 108;

export class MidiPlaybackError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MidiPlaybackError";
    this.code = code;
  }
}

// Preserve the legacy velocity layers; velocities 120–127 use f, not ff.
export function piano_sample(note, root = PIANO_SAMPLE_ROOT) {
  if (
    !Number.isInteger(note.pitch) ||
    note.pitch < PIANO_MIN_PITCH ||
    note.pitch > PIANO_MAX_PITCH
  )
    throw new MidiPlaybackError(
      "unsupported_pitch",
      "Piano playback supports MIDI pitches 21 through 108.",
    );
  if (note.channel === 9)
    throw new MidiPlaybackError(
      "unsupported_percussion",
      "Percussion-channel playback is not supported by this piano.",
    );
  if (
    !Number.isInteger(note.velocity) ||
    note.velocity < 1 ||
    note.velocity > 127
  )
    throw new MidiPlaybackError(
      "invalid_velocity",
      "Invalid MIDI note velocity.",
    );
  const layer_index = Math.floor(note.velocity / 40);
  const layer = ["p", "mp", "mf", "f"][layer_index];
  const volume = note.velocity / [128, 128, 144, 256][layer_index];
  return {
    url: `${root.replace(/\/$/, "")}/${layer}/GrandB_${layer}_${String(note.pitch).padStart(3, "0")}_mono.mp3`,
    gain: volume * 0.5,
    // Native GrandB probes measured 10.033 s mono. Reserve a conservative
    // 10.1 s at the actual context rate instead of treating unknown size as zero.
    estimated_duration_seconds: 10.1,
    estimated_channels: 1,
    pan:
      ((note.pitch - PIANO_MIN_PITCH) / (PIANO_MAX_PITCH - PIANO_MIN_PITCH)) *
        1.2 -
      0.6,
    release_seconds: 0.5 + volume * 0.25,
  };
}
