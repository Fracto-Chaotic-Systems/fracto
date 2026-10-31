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
