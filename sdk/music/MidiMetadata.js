export const midi_event_id = (event) =>
  `track:${event.track}:event:${event.event_index}`;
const provenance = (event, seconds) => ({
  id: midi_event_id(event),
  track: event.track,
  event_index: event.event_index,
  channel: event.channel ?? null,
  tick: event.tick,
  seconds,
});

export function create_midi_metadata() {
  return {
    track_names: [],
    instrument_names: [],
    text_events: [],
    time_signatures: [],
    pedal_events: [],
    program_changes: [],
    controller_events: [],
  };
}

// Capture display data at the same clock instant used by note preparation.
export function record_midi_metadata(
  metadata,
  tracks,
  event,
  seconds,
  channel,
) {
  const point = provenance(event, seconds);
  if (event.type === 255) {
    if ([1, 2, 6, 7].includes(event.metaType))
      metadata.text_events.push({
        ...point,
        meta_type: event.metaType,
        text: event.data,
      });
    if (event.metaType === 3)
      metadata.track_names.push({ ...point, name: event.data });
    if (event.metaType === 4) {
      metadata.instrument_names.push({ ...point, name: event.data });
      tracks[event.track].instrument_name = event.data;
    }
    if (event.metaType === 88) {
      const [
        numerator,
        exponent,
        clocks_per_click,
        thirty_seconds_per_quarter,
      ] = event.data;
      metadata.time_signatures.push({
        ...point,
        numerator,
        denominator: 2 ** exponent,
        denominator_exponent: exponent,
        clocks_per_click,
        thirty_seconds_per_quarter,
        inferred: false,
      });
    }
  } else if (event.type === 12) {
    metadata.program_changes.push({
      ...point,
      program: event.data,
      bank_msb: channel.bank_msb,
      bank_lsb: channel.bank_lsb,
    });
  } else if (event.type === 11) {
    const [controller, value] = event.data;
    metadata.controller_events.push({ ...point, controller, value });
    if (controller === 64)
      metadata.pedal_events.push({
        ...point,
        controller,
        value,
        down: value >= 64,
        inferred: false,
      });
    // Reset Controllers releases a held pedal, even without an explicit CC64.
    if (controller === 121 && channel.sustain)
      metadata.pedal_events.push({
        ...point,
        controller,
        value: 0,
        down: false,
        inferred: true,
      });
  }
}

export function complete_midi_metadata(metadata, tempos) {
  if (!tempos.length || tempos[0].tick > 0)
    tempos.unshift({
      id: "default:tempo",
      track: null,
      channel: null,
      event_index: null,
      tick: 0,
      seconds: 0,
      microseconds_per_quarter: 500000,
      inferred: true,
    });
  if (!metadata.time_signatures.length || metadata.time_signatures[0].tick > 0)
    metadata.time_signatures.unshift({
      id: "default:meter",
      track: null,
      event_index: null,
      channel: null,
      tick: 0,
      seconds: 0,
      numerator: 4,
      denominator: 4,
      denominator_exponent: 2,
      clocks_per_click: 24,
      thirty_seconds_per_quarter: 8,
      inferred: true,
    });
}

// The parsed song is a read-only value shared by the audio engine and viewer.
export function freeze_midi_song(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze_midi_song(child);
    Object.freeze(value);
  }
  return value;
}
