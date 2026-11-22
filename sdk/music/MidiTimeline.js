import { MidiFileError } from "./MidiValidation.js";
import {
  create_midi_metadata,
  record_midi_metadata,
  complete_midi_metadata,
  midi_event_id,
} from "./MidiMetadata.js";

// Input is adapter-validated parser output. Channel state is shared across tracks.
export function build_midi_timeline(data) {
  const events = [];
  const tracks = data.track.map((track, track_index) => {
    let tick = 0;
    let name = "";
    track.event.forEach((event, event_index) => {
      tick += event.deltaTime;
      if (event.type === 255 && event.metaType === 3) name = event.data;
      events.push({ ...event, tick, track: track_index, event_index });
    });
    return { index: track_index, name, instrument_name: "", end_tick: tick };
  });
  // Preserve order within each track; simultaneous tracks resolve by track index.
  events.sort(
    (a, b) =>
      a.tick - b.tick || a.track - b.track || a.event_index - b.event_index,
  );
  const channels = Array.from({ length: 16 }, () => ({
    sustain: false,
    pressed: new Map(),
    sustained: new Set(),
    program: 0,
    bank_msb: 0,
    bank_lsb: 0,
  }));
  const metadata = create_midi_metadata();
  const notes = [];
  const warnings = [];
  const tempos = [];
  let seconds = 0;
  let previous_tick = 0;
  let tempo = 500000;
  let unmatched = 0;
  const finish = (note) => {
    note.end_seconds = seconds;
    note.end_tick = previous_tick;
  };
  const release_pedal = (channel) => {
    channel.sustained.forEach(finish);
    channel.sustained.clear();
  };
  const release_key = (channel, pitch) => {
    const queue = channel.pressed.get(pitch);
    if (!queue || queue.head === queue.notes.length) {
      unmatched++;
      return;
    }
    // FIFO without repeated Array.shift() copies for dense overlapping files.
    const note = queue.notes[queue.head++];
    if (queue.head === queue.notes.length) channel.pressed.delete(pitch);
    note.key_release_seconds = seconds;
    note.key_release_tick = previous_tick;
    if (channel.sustain) channel.sustained.add(note);
    else finish(note);
  };
  for (const event of events) {
    seconds +=
      ((event.tick - previous_tick) * tempo) / (data.timeDivision * 1000000);
    previous_tick = event.tick;
    if (!Number.isFinite(seconds))
      throw new MidiFileError("Invalid MIDI timeline duration.");
    record_midi_metadata(
      metadata,
      tracks,
      event,
      seconds,
      channels[event.channel],
    );
    if (event.type === 255) {
      if (event.metaType === 81) {
        tempo = event.data;
        tempos.push({
          tick: event.tick,
          seconds,
          microseconds_per_quarter: tempo,
          id: midi_event_id(event),
          track: event.track,
          channel: null,
          event_index: event.event_index,
          inferred: false,
        });
      }
      continue;
    }
    const channel = channels[event.channel];
    if (!channel) continue; // SysEx has no playback effect.
    if (event.type === 12) channel.program = event.data;
    if (event.type === 9 && event.data[1] > 0) {
      const pitch = event.data[0];
      const note = {
        id: `note:${event.track}:${event.event_index}`,
        start_tick: event.tick,
        key_release_tick: null,
        end_tick: null,
        track: event.track,
        channel: event.channel,
        pitch,
        velocity: event.data[1],
        program: channel.program,
        bank_msb: channel.bank_msb,
        bank_lsb: channel.bank_lsb,
        start_seconds: seconds,
        key_release_seconds: null,
        end_seconds: null,
      };
      notes.push(note);
      if (!channel.pressed.has(pitch))
        channel.pressed.set(pitch, { notes: [], head: 0 });
      channel.pressed.get(pitch).notes.push(note);
    } else if (event.type === 8 || (event.type === 9 && event.data[1] === 0)) {
      release_key(channel, event.data[0]);
    } else if (event.type === 11) {
      const [controller, value] = event.data;
      if (controller === 0) channel.bank_msb = value;
      else if (controller === 32) channel.bank_lsb = value;
      else if (controller === 64) {
        channel.sustain = value >= 64;
        if (!channel.sustain) release_pedal(channel);
      } else if (controller === 120) {
        channel.pressed.forEach((queue) =>
          queue.notes.slice(queue.head).forEach((note) => {
            note.key_release_seconds = seconds;
            note.key_release_tick = previous_tick;
            finish(note);
          }),
        );
        channel.pressed.clear();
        release_pedal(channel);
      } else if (controller === 123) {
        for (const [pitch, queue] of [...channel.pressed]) {
          for (let index = queue.notes.length - queue.head; index > 0; index--)
            release_key(channel, pitch);
        }
      } else if (controller === 121) {
        channel.sustain = false;
        release_pedal(channel);
      }
    }
  }
  let unfinished = 0;
  for (const channel of channels) {
    channel.pressed.forEach((queue) =>
      queue.notes.slice(queue.head).forEach((note) => {
        unfinished++;
        note.key_release_seconds = seconds;
        note.key_release_tick = previous_tick;
        finish(note);
      }),
    );
    unfinished += channel.sustained.size;
    release_pedal(channel);
  }
  if (unmatched)
    warnings.push({ code: "unmatched_note_off", count: unmatched });
  if (unfinished)
    warnings.push({ code: "unfinished_notes", count: unfinished });
  const unsupported = notes.filter(
    (note) => note.pitch < 21 || note.pitch > 108,
  );
  if (unsupported.length)
    warnings.push({
      code: "piano_pitch_out_of_range",
      count: unsupported.length,
    });
  const percussion = notes.filter((note) => note.channel === 9);
  if (percussion.length)
    warnings.push({ code: "percussion_channel", count: percussion.length });
  if (!notes.length)
    throw new MidiFileError("MIDI file contains no playable note events.");
  complete_midi_metadata(metadata, tempos);
  return {
    ...metadata,
    format: data.formatType,
    ppq: data.timeDivision,
    tracks,
    notes,
    tempos,
    duration_seconds: seconds,
    warnings,
  };
}
