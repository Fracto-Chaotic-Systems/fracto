import { freeze_midi_song } from "./MidiMetadata.js";
import MidiParser from "midi-parser-js";
import { validate_midi, MidiFileError } from "./MidiValidation.js";
import { build_midi_timeline } from "./MidiTimeline.js";

export { MidiFileError } from "./MidiValidation.js";

// Skip unknown payloads once, avoiding midi-parser-js 4.0.4's double-read bug.
function interpret_unknown(_type, file, length) {
  const size = length === false ? file.readIntVLV() : length;
  if (size < 0 || file.pointer + size > file.data.byteLength)
    throw new MidiFileError("Truncated MIDI payload.");
  file.movePointer(size);
  return null;
}

export function events_from_midi(input) {
  const validated = validate_midi(input);
  const previous = MidiParser.customInterpreter;
  let data;
  try {
    MidiParser.customInterpreter = interpret_unknown;
    data = MidiParser.parse(validated.bytes);
  } catch (error) {
    throw new MidiFileError(`Unable to parse MIDI file: ${error.message}`);
  } finally {
    // Parsing is synchronous; do not leak the hook into other parser consumers.
    MidiParser.customInterpreter = previous;
  }
  if (
    !data ||
    data.formatType !== validated.format ||
    data.timeDivision !== validated.ppq ||
    data.tracks !== validated.tracks.length ||
    !Array.isArray(data.track) ||
    data.track.length !== validated.tracks.length
  )
    throw new MidiFileError("MIDI parser returned an inconsistent header.");
  data.track.forEach((track, index) => {
    let ticks = 0;
    if (
      !Array.isArray(track.event) ||
      track.event.length !== validated.tracks[index].event_count
    )
      throw new MidiFileError(
        "MIDI parser returned an inconsistent event count.",
      );
    track.event.forEach((event) => {
      if (!Number.isInteger(event.deltaTime) || event.deltaTime < 0)
        throw new MidiFileError("Invalid MIDI event timing.");
      ticks += event.deltaTime;
      if (event.type >= 8 && event.type <= 14) {
        const values = Array.isArray(event.data) ? event.data : [event.data];
        if (
          !Number.isInteger(event.channel) ||
          event.channel < 0 ||
          event.channel > 15 ||
          values.some(
            (value) => !Number.isInteger(value) || value < 0 || value > 127,
          )
        )
          throw new MidiFileError("Invalid MIDI channel event.");
      }
    });
    if (ticks !== validated.tracks[index].end_tick)
      throw new MidiFileError(
        "MIDI parser returned inconsistent track timing.",
      );
  });
  const song = build_midi_timeline(data);
  if (validated.trailing_bytes)
    song.warnings.push({
      code: "trailing_bytes_ignored",
      count: validated.trailing_bytes,
    });
  return freeze_midi_song(song);
}
