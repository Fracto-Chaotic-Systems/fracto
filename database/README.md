# Database assets

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
