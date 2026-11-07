# Database assets

Migration 008 adds an indexed primary `free_bailiwick_id` reference to stored
orbitals. It is populated on insert/rediscovery; existing coordinates and ray
data are preserved, and additional source associations remain in run provenance.

Migration 007 adds the five orbital discovery/progression/point/ratio/provenance
tables without seeding data or changing `free_bailiwicks`. Discovery is explicitly
requested for one source row. The exact schema and disposable single-core-point
verification are documented in `servers/fracto-data-server/ORBITAL_DATA.md` and
its schema reference.

`migrations/` contains immutable, numbered MySQL schema/data changes applied by
`npm run db:migrate`. See its README for bootstrap, checksum and locking behavior.
The WordNet mapping migration stores the curated worlds definitions as a database
snapshot. The browser now reads live mappings through the data service.

The worlds UI now reads this table through the data service `/wordnet_mappings`
endpoint. The original migration remains an immutable initial snapshot. The database is the only persistent source of notes; browser edits save back
through the notes endpoint, with no localStorage overrides.

Migration 005 adds world_name to wordnet_mappings, initializing existing rows as
`world N`. The name is returned by the mappings API and included in CSV exports.

Migration 006 appends unapproved name suggestions to notes for all 318 worlds.
The actual world_name values remain unchanged. seeds/ contains the editorial
proposal source and supporting references.

Routine world-name and database-note edits now use POST /data/request rather than
a new migration. Migrations still own schema changes and initial snapshots.

The current world-naming philosophy is documented in seeds/README.md: prioritize
meaningful literary/cinematic references and discuss each world individually
before adopting a name. The original bulk proposal remains historical context.

Migration 009 adds nullable survey discovery metadata to orbital headers and
run memberships. Apply it before deploying `orbital-discovery-v2`. It performs
no backfill; existing coordinates, ratios and source references are preserved.

Migration 010 adds durable orbital-job checkpoints, an execution ownership token,
and resume counters. Apply before the resumable coordinator. Existing runs and
orbital data are retained without checkpoint backfill. New jobs checkpoint work
units and can resume with the same UUID after cancellation or interruption.
