// Bound both the validation pass and the legacy parser before it sees input.
export const MAX_MIDI_BYTES = 8 * 1024 * 1024;
export const MAX_MIDI_EVENTS = 200000;
export const MAX_MIDI_TRACKS = 256;

export class MidiFileError extends Error {
  constructor(message) {
    super(message);
    this.name = "MidiFileError";
  }
}

export function validate_midi(input) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  if (!(bytes instanceof Uint8Array))
    throw new MidiFileError(
      "Expected MIDI bytes as an ArrayBuffer or Uint8Array.",
    );
  if (bytes.length > MAX_MIDI_BYTES)
    throw new MidiFileError("MIDI file exceeds the 8 MiB limit.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 0;
  let limit = bytes.length;
  const need = (count) => {
    if (count < 0 || cursor + count > limit)
      throw new MidiFileError(`Truncated MIDI data at byte ${cursor}.`);
  };
  const byte = () => {
    need(1);
    return bytes[cursor++];
  };
  const word = () => {
    need(2);
    const value = view.getUint16(cursor);
    cursor += 2;
    return value;
  };
  const integer = () => {
    need(4);
    const value = view.getUint32(cursor);
    cursor += 4;
    return value;
  };
  const tag = () => String.fromCharCode(byte(), byte(), byte(), byte());
  const vlq = () => {
    let value = 0;
    for (let index = 0; index < 4; index++) {
      const next = byte();
      value = value * 128 + (next & 127);
      if (next < 128) return value;
    }
    throw new MidiFileError("MIDI variable-length value exceeds four bytes.");
  };
  if (tag() !== "MThd" || integer() !== 6)
    throw new MidiFileError(
      "Invalid MIDI header; expected a six-byte MThd header.",
    );
  const format = word();
  const track_count = word();
  const ppq = word();
  if (format !== 0 && format !== 1)
    throw new MidiFileError("Only MIDI formats 0 and 1 are supported.");
  if (
    !track_count ||
    track_count > MAX_MIDI_TRACKS ||
    (format === 0 && track_count !== 1)
  )
    throw new MidiFileError(
      "Invalid or unsupported MIDI track count (maximum 256).",
    );
  if (ppq & 0x8000)
    throw new MidiFileError("SMPTE MIDI timing is not supported.");
  if (!ppq)
    throw new MidiFileError("MIDI ticks per quarter note must be positive.");
  const tracks = [];
  let event_count = 0;
  for (let track = 0; track < track_count; track++) {
    limit = bytes.length;
    if (tag() !== "MTrk")
      throw new MidiFileError("Expected a MIDI track chunk.");
    const length = integer();
    need(length);
    limit = cursor + length;
    let running_status = null;
    let ended = false;
    let ticks = 0;
    let count = 0;
    while (cursor < limit) {
      if (++event_count > MAX_MIDI_EVENTS)
        throw new MidiFileError("MIDI file exceeds the 200,000-event limit.");
      count++;
      ticks += vlq();
      let status = byte();
      if (status < 128) {
        if (running_status === null)
          throw new MidiFileError(
            "MIDI running status has no preceding channel event.",
          );
        cursor--;
        status = running_status;
      }
      if (status >= 0x80 && status <= 0xef) {
        running_status = status;
        const size = status >> 4 === 12 || status >> 4 === 13 ? 1 : 2;
        for (let index = 0; index < size; index++) {
          if (byte() > 127)
            throw new MidiFileError(
              "MIDI channel data must be between 0 and 127.",
            );
        }
      } else if (status === 0xff) {
        running_status = null;
        const type = byte();
        if (type > 127) throw new MidiFileError("Invalid MIDI metadata type.");
        const size = vlq();
        need(size);
        const fixed = {
          0x00: 2,
          0x20: 1,
          0x21: 1,
          0x2f: 0,
          0x51: 3,
          0x54: 5,
          0x58: 4,
          0x59: 2,
        };
        if (fixed[type] !== undefined && size !== fixed[type])
          throw new MidiFileError("Invalid MIDI metadata payload length.");
        if (
          type === 0x51 &&
          bytes[cursor] + bytes[cursor + 1] + bytes[cursor + 2] === 0
        )
          throw new MidiFileError("MIDI tempo must be positive.");
        cursor += size;
        if (type === 0x2f) {
          ended = true;
          if (cursor !== limit)
            throw new MidiFileError("Unexpected data after MIDI end-of-track.");
        }
      } else if (status === 0xf0 || status === 0xf7) {
        running_status = null;
        const size = vlq();
        need(size);
        cursor += size;
      } else throw new MidiFileError("Unsupported MIDI system event.");
    }
    if (!ended) throw new MidiFileError("MIDI track is missing end-of-track.");
    tracks.push({ event_count: count, end_tick: ticks });
  }
  // Some legacy exports append garbage after all declared, complete tracks.
  // Exclude it from the parser's view and report it instead of losing the song.
  return {
    bytes: bytes.subarray(0, cursor),
    format,
    ppq,
    tracks,
    event_count,
    trailing_bytes: bytes.length - cursor,
  };
}
