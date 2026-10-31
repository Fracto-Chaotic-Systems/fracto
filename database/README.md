# Database assets

`migrations/` contains immutable, numbered MySQL schema/data changes applied by
`npm run db:migrate`. See its README for bootstrap, checksum and locking behavior.
The WordNet mapping migration stores the curated worlds definitions as a database
snapshot; it does not change the browser's data source or saved notes.
