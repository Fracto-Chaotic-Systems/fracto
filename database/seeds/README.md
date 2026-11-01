# Curated database seeds

`world-name-suggestions-v1.txt` is the reviewable first naming proposal for all
318 currently mapped worlds. Each UTF-8 line is pipe-delimited:

`cardinality|theme|candidate name|brief reason[|alternative name|reason...]`

There are one to three suggestions per world. Names are creative interpretations,
not claims that an entire historical or mythological figure reduces to one trait.
Original coinages, ordinary evocative words, and documented allusions are mixed.
These proposals are unapproved; world_name stays `world N`. Existing compound
explanations remain first in each note. No assignments or prime archetypes change.

Generate a new immutable snapshot with `scripts/world_name_suggestions.js`; see
scripts/README.md. Migration 006 appends the proposal text once, matching both
cardinality and WordNet sense. Routine editorial revisions now use POST /data/request; this seed remains the
immutable initial proposal.

## Current naming philosophy: literary references, one world at a time

The initial bulk proposal is an unapproved starting point. Subsequent naming work
focuses on individual worlds, discussed with the user before any name is adopted.
Favor meaningful references from literature, film and fictional universes,
especially mystery, science fiction and fantasy. Sources include Harry Potter,
The Lord of the Rings, Star Trek, Star Wars and other fantasy franchises; these
are examples, not an exhaustive list or a franchise quota. Historical and
mythological references are equally useful when they provide a stronger connection.
General settings and abstract worlds also work when their meaning is clearer than
a named allusion; a recognizable source is not required.

- Prefer an evocative existing name whose narrative significance expresses the
  world's theme, rather than a generic thematic label or a forced new coinage.
- A place, court or other institution, character, object, inscription, title or
  recurring motif can supply a name. It need not already name a fictional world.
- Connect the reference to a specific scene, role, defining quality or mystery.
  A recognizable franchise reference alone is insufficient. An ironic or
  cautionary connection is welcome: a flawed judgment can illuminate judgment.
- Preserve the existing abstraction and its compound interpretation. Naming adds
  narrative resonance; it does not reassign the theme, prime or cardinality.
- Prefer variety across sources rather than repeatedly drawing on one franchise.
  Flag overlapping candidates for later review rather than adopting duplicates by
  default. Use religious references when their established meaning supports the
  theme, and distinguish that meaning from creative extensions.
- Discuss each case separately. Offer up to three alternatives when useful, with
  a brief explanation of the source and the theme connection. Verify names and
  canonical details, distinguishing those facts from our creative interpretation.
- For borrowed names, retain provenance in the world notes: work/franchise,
  author or creator, an official reference URL when available, and the source's
  copyright/trademark/publishing-rights notice where relevant. Record unknown or
  unresolved ascriptions explicitly rather than guessing. Mark usage review as
  pending until investigated; citation or attribution does not establish permission.
  Record restrictions or a decision not to use a term if later investigation
  identifies a blocker. A naming preference is separate from usage clearance.
- Examples and discussion are proposals, not approval to rename. Leave `world N`
  in world_name until the user chooses a name for that specific entry. Apply an
  approved choice through POST /data/request with an expected-value check rather
  than a migration. Do not replace the existing bulk notes without instruction.

### Illustrative proposals, not adopted names

**World 28, judgment: Wizengamot.** This is the Harry Potter court the user had in
mind. Harry faces a hearing there and is cleared; do not describe him as having
been unfairly convicted. The dramatic tension around judgment and an unfairly
pursued hearing makes the institution a potential thematic name, even though its
conduct is not an ideal of justice. See the
[official Wizengamot entry](https://www.harrypotter.com/fact-file/magical-miscellany/the-wizengamot).

**Earlier world 31 proposal, attribute: Rosebud (superseded).** In Citizen Kane, the word belongs to Kane's
childhood sled. Its role as an identifying inscription with concealed significance
provides a creative connection to an object's distinguishing attribute. The
reference's additional associations with memory and identity do not require
changing the assigned theme. See the
[American Film Institute's Citizen Kane reference](https://www.afi.com/news/afi-movie-club-citizen-kane/).

These examples establish the intended style; neither is a decided world name.
The user subsequently replaced all world 31 suggestions with Linnaeus Garden,
with Uppsala as a variant. Current suggestions and preference order live in the
database notes; the original seed and these historical examples are not a current
export. Routine editorial changes are database records, not Git-tracked migrations.

Record approved candidate variants, preference order, related-world distinctions
and possible gameplay roles in the notes. A possible role (such as world 53 as an
energy power-up location) is a design annotation, not an implemented mechanic.
Preserve existing notes when asked to add suggestions; replace the suggestion list
when explicitly requested. Keep the compound explanation and world name unchanged
unless the user directs otherwise.

## Reference checks

These sources support specific allusions; the proposed theme interpretations are
editorial choices rather than conclusions asserted by these sources.

- [Descartes' own Discourse on Method](https://www.gutenberg.org/files/59/59-h/59-h.htm): Cogito.
- [Bibliotheca Alexandrina](https://www.bibalex.org/en/page/overview): Alexandria and scholarship.
- [Proteus and classical excerpts](https://www.theoi.com/Pontios/Proteus.html): shape changing.
- [Themis](https://www.theoi.com/Titan/TitanisThemis.html): law and right order.
- [Mnemosyne and Lethe](https://www.theoi.com/Titan/TitanisMnemosyne.html): remembering and forgetting.
- [Bifrost](https://snl.no/Bifrost): the bridge between realms.
- [Greek personifications](https://www.theoi.com/greek-mythology/greek-gods.html): divine and abstract figures.
- [Chronos and Kratos](https://www.theoi.com/greek-mythology/encyclopedia-c.html): time and strength.
- [The ship of Theseus](https://plato.stanford.edu/entries/identity-relative/): identity questions.
- [Thomas More's Utopia](https://www.loc.gov/exhibits/thomas-jeffersons-library/interactives/sir-thomas-mores-utopia/index.html): imagined society.
- [The Tempest, Folger edition](https://www.folgerdigitaltexts.org/Tmp/): Prospero, Ariel and relinquishing magic.
- [Royal Museums Greenwich](https://www.rmg.co.uk/stories/time/greenwich-mean-time-gmt): Greenwich timekeeping.
- [Greek Ministry of Culture on Antikythera](https://olympicgames.culture.gov.gr/en/texnologia/1_Mixanismos-Antikithirwn.html): astronomical calculation.
- [Androcles and the Lion](https://www.gutenberg.org/ebooks/4003): the literary tradition of kindness remembered.
- [Penelope, Oxford Classical Dictionary](https://academic.oup.com/edited-volume/61673/chapter-abstract/549685302): fidelity while awaiting Odysseus.
- [Kairos](https://www.theoi.com/Daimon/Kairos.html), [Elpis](https://www.theoi.com/Daimon/Elpis.html),
  [Aletheia](https://www.theoi.com/Daimon/Aletheia.html), [Tyche](https://www.theoi.com/Daimon/Tykhe.html),
  [Ananke](https://www.theoi.com/Protogenos/Ananke.html): opportunity, hope, truth, fortune and necessity.

Further checks: [Linnaeus](https://www.linnean.org/learning/who-was-linnaeus),
[Tartarus](https://www.theoi.com/Kosmos/Tartaros2.html),
[Ariadne](https://www.theoi.com/Georgikos/Ariadne.html),
[Tantalus in classical texts](https://www.theoi.com/Text/TzetzesChiliades5.html),
and [the Rosetta Stone](https://www.britishmuseum.org/collection/object/Y_EA24).

### Current per-world notes layout

Follow the user's edited database entries when making future editorial revisions:
start with `## theme`, then an italic summary with a bold archetype or compound
lead-in, for example `_**knowledge x time:** explanation_`. Keep the formula in
its own table column rather than repeating numeric factorization in this summary.
Use `### World name suggestions (unapproved):`, a blank line, then list items
of the form `- **Candidate:** interpretation`. Put candidate-specific attribution,
variants and references in nested bullets with bold labels. Separate shared
related-world distinctions, franchise-placement observations and review comments
into paragraphs outside the final candidate's nested details. Preserve meaningful
user wording and structure rather than normalizing all existing notes again.
These conventions guide future revisions; the database remains authoritative.

### Reciprocal world cross-references

Whenever an editorial note adds a cross-reference to another world, also update
that world's database note with the corresponding distinction or connection back
to the originating world. Explain the relationship from each world's perspective;
do not merely add an unexplained backlink. Preserve existing suggestions and
notes, and avoid duplicate distinctions when a reciprocal reference already exists.
Use plain `#cardinality theme` references in saved Markdown; browser-specific
links and scrolling behavior belong only to the rendering layer. Apply both note
edits through the data request API with expected-value checks and readback
verification, not seed migrations. If either edit fails, report and reconcile the
incomplete pair rather than silently treating the cross-reference as complete.

The 2026-11-01 retrospective audit scanned all 318 current notes for explicit
numbered world references (`#N`, `world N`, and `world #N`). It added 38 missing
reciprocal explanations across 29 notes, preserving all prior text, suggestions,
and other fields. Shared-reference placement notes (such as Cogito and Doctor
Who) also receive explained back-references. These are plain prose references,
not saved Markdown hyperlinks. The operational recovery snapshot is kept under
ignored `backup/world-notes-before-backreferences-2026-11-01.json`; it is not a
migration or authoritative seed. References expressed solely by theme or candidate
name without a world number are not inferred automatically.
