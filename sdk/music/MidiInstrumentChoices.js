import { DEFAULT_INSTRUMENT, ORIGINAL_INSTRUMENT } from "./MidiInstruments.js";

export const instrument_label = (provider, text) =>
  provider.name ?? text(provider.label_key);

// The registry is the authority for playability; inventory never enables a source.
export function instrument_choices(notes, registry, catalog, selection) {
  const percussion =
    notes.length > 0 && notes.every((note) => note.channel === 9);
  const library_id = percussion
    ? registry.libraries.find(
        (library) => library.id === registry.default_library_id,
      )?.percussion_library_id
    : registry.default_library_id;
  const choices = Object.values(registry.providers)
    .filter(
      (provider) =>
        !!provider.percussion === percussion &&
        ((!percussion && provider.id === DEFAULT_INSTRUMENT) ||
          provider.library_id === library_id ||
          provider.id === selection),
    )
    .map((provider) => ({
      id: provider.id,
      name:
        provider.name &&
        provider.library_id !== library_id &&
        provider.id !== DEFAULT_INSTRUMENT
          ? `${provider.name} · ${provider.library_name ?? provider.library_id}`
          : provider.name,
      label_key: provider.label_key,
      reason: registry.can_assign(notes, provider.id)
        ? null
        : "instrument_coverage",
    }));
  const ids = new Set(choices.map((choice) => choice.id));
  for (const item of (percussion ? catalog?.drum_kits : catalog?.instruments) ??
    []) {
    if ((item.library_id ?? "legacy") !== library_id) continue;
    const id = `asset-${item.id}`;
    if (ids.has(id)) continue;
    choices.push({
      id,
      name: item.name,
      reason: !(percussion ? item.assets_available : item.available)
        ? "instrument_assets_unavailable"
        : "instrument_not_enabled",
    });
  }
  return choices;
}

export function effective_instrument(
  notes,
  selection = DEFAULT_INSTRUMENT,
  registry,
  text,
) {
  if (!registry.can_assign(notes, selection))
    return text("instrument_not_playable");
  const ids =
    selection === ORIGINAL_INSTRUMENT
      ? [
          ...new Set(
            notes.map(
              (note) => registry.resolve(note, selection).instrument_id,
            ),
          ),
        ]
      : [selection];
  return ids
    .map((id) => instrument_label(registry.providers[id], text))
    .join(", ");
}
