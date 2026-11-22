import { piano_sample, MidiPlaybackError } from "./MidiPianoSamples.js";
export const DEFAULT_INSTRUMENT = "grandb";
export const ORIGINAL_INSTRUMENT = "original";

export const GRANDB_PROVIDER = Object.freeze({
  id: DEFAULT_INSTRUMENT,
  library_id: "legacy",
  instrument_key: "grandb",
  version: "1",
  label_key: "instrument_grandb",
  verified: true,
  programs: Object.freeze([0]),
  min_pitch: 21,
  max_pitch: 108,
  percussion: false,
  sample: (note, options = {}) => piano_sample(note, options.sample_root),
});

// Providers are an explicit code-owned, verified catalog, never remote scripts.
export function create_instrument_registry(
  definitions,
  { default_library_id = "legacy", libraries = [] } = {},
) {
  const providers = Object.create(null);
  for (const definition of definitions) {
    if (!definition.verified) continue;
    if (
      !definition.id ||
      definition.id === ORIGINAL_INSTRUMENT ||
      Object.hasOwn(providers, definition.id) ||
      typeof definition.sample !== "function"
    )
      throw new Error("Invalid or duplicate instrument provider.");
    providers[definition.id] = Object.freeze({
      ...definition,
      library_id: definition.library_id ?? "legacy",
      instrument_key: definition.instrument_key ?? definition.id,
      programs: Object.freeze([...definition.programs]),
    });
  }
  Object.freeze(providers);
  const supports = (provider, note) =>
    !!provider &&
    (provider.percussion ? note.channel === 9 : note.channel !== 9) &&
    note.pitch >= provider.min_pitch &&
    note.pitch <= provider.max_pitch &&
    (!provider.supports_note || provider.supports_note(note));
  const original = (note, library_id = default_library_id) => {
    // Only standard-bank mappings are verified. A numbered GM program alone
    // must not silently reinterpret a bank-select or percussion assignment.
    if ((note.bank_msb ?? 0) !== 0 || (note.bank_lsb ?? 0) !== 0) return null;
    // Original GM Acoustic Grand Piano uses the preferred Legacy recording.
    // Explicit route overrides still select their requested provider directly.
    if (
      note.channel !== 9 &&
      (note.program ?? 0) === 0 &&
      (libraries.length === 0 ||
        libraries.some((library) => library.id === library_id))
    )
      return supports(providers[DEFAULT_INSTRUMENT], note)
        ? providers[DEFAULT_INSTRUMENT]
        : null;
    return Object.values(providers).find(
      (provider) =>
        provider.library_id ===
          (note.channel === 9
            ? libraries.find((library) => library.id === library_id)
                ?.percussion_library_id
            : library_id) &&
        provider.programs.includes(note.program ?? 0) &&
        supports(provider, note),
    );
  };
  return Object.freeze({
    providers,
    can_select_library(id) {
      return (
        (libraries.length === 0 ||
          libraries.some(
            (l) =>
              l.id === id && l.status === "active" && l.source_format !== "sf2",
          )) &&
        Object.values(providers).some((p) => p.library_id === id)
      );
    },
    with_library(id) {
      return create_instrument_registry(Object.values(providers), {
        libraries,
        default_library_id: id,
      });
    },
    default_library_id,
    libraries: Object.freeze(
      libraries.map((library) => Object.freeze({ ...library })),
    ),
    signature: JSON.stringify([
      default_library_id,
      Object.values(providers).map((provider) => [
        provider.id,
        provider.version,
        provider.programs,
        provider.source_identity ?? null,
        provider.library_id,
        provider.instrument_key,
      ]),
    ]),
    can_assign(notes, selection, library_id = default_library_id) {
      return (
        notes.length > 0 &&
        notes.every((note) =>
          selection === ORIGINAL_INSTRUMENT
            ? !!original(note, library_id)
            : supports(providers[selection], note),
        )
      );
    },
    resolve(note, selection = DEFAULT_INSTRUMENT, options = {}) {
      const provider =
        selection === ORIGINAL_INSTRUMENT
          ? original(note, options.library_id ?? default_library_id)
          : providers[selection];
      if (!provider)
        throw new MidiPlaybackError(
          "instrument_unavailable",
          "No verified sound source supports this instrument assignment.",
        );
      if (!supports(provider, note))
        throw new MidiPlaybackError(
          note.channel === 9 ? "unsupported_percussion" : "unsupported_pitch",
          "This verified instrument cannot play that pitch or channel.",
        );
      const sample = provider.sample(note, options);
      return {
        ...sample,
        instrument_id: provider.id,
        library_id: provider.library_id,
        instrument_key: provider.instrument_key,
        cache_key: `${provider.id}@${provider.version}:${sample.url}`,
      };
    },
  });
}
export const INSTRUMENT_REGISTRY = create_instrument_registry([
  GRANDB_PROVIDER,
]);
