# Database migrations

`017_orbital-denominator-catalog.sql` creates the focal-independent exact angle
catalog. `orbital_catalog_denominators` stores period, divisor candidates and
coverage counts; `orbital_catalog_families` stores every canonical numerator,
indexed by numerator and denominator. The representative and denominator encode
the entire doubling cycle exactly, without per-angle rows or ray geometry.
Each denominator is published transactionally by the database catalog builder.
This migration is additive, replay-safe, and performs no calculations or backfill.

`016_orbital-lifecycle-state.sql` adds nullable JSON lifecycle state to
`orbital_progressions`, separating orbital validation, ratio assignments and path
availability. It is guarded for replay and performs no backfill. Old rows normalize
on read; existing coordinates, ratios, caches and resumable work are retained.

`015_orbital-ray-cache-chunks.sql` adds immutable content-addressed binary chunks
for catalog outcomes and Julia caches that exceed the inline 20 MiB envelope.
Each chunk is at most 8 MiB; existing JSON columns retain small verified manifests.
Old inline/gzip cache rows remain compatible. Apply before the updated orbital
codec; no backfill, coordinate change or recalculation occurs.

`014_orbital-family-job-owners.sql` adds nullable run/execution owner fields to
catalog family leases. A resumed job can reclaim its previous execution's
abandoned work immediately; stale executions remain fenced from publication.
It is replay-safe and performs no recalculation or backfill. Apply after 013
before deploying the catalog job coordinator.

`013_orbital-family-investigations.sql` adds the denominator-catalog investigation
ledger and append-only attempt history. Identity binds exact focal coordinates,
family, catalog/solver versions, and numerical settings. Rows track pending,
investigating, validated, and unresolved outcomes, with fenced expiring leases.
Validated points, ratios, and compressed geometry survive process restarts;
optional orbital links use `ON DELETE SET NULL`. It performs no backfill and
does not change existing orbital or ray-cache rows.

`008_orbital-bailiwick-source.sql` adds nullable, indexed
`orbital_progressions.free_bailiwick_id`. New saves include the selected table ID;
rediscovery fills a previously missing ID without replacing a primary source.
It performs no orbital calculations or bulk metadata backfill. Both its column
and index definitions are guarded for replay/recovery.

`007_orbital-progressions.sql` creates five InnoDB tables for persistent orbital
discovery runs, independent cycles, ordered points, exact Julia landing ratios,
and run-to-orbital provenance. It is additive and replay-safe and does not perform
a backfill. Apply through the normal runner; missing tables produce an explicit
503 from the new service routes. See
[the orbital data contract](../../servers/fracto-data-server/ORBITAL_DATA.md).

The initializer has two modes:

1. An empty database is bootstrapped from the read-only SQL dumps in `backup/`.
2. A database that already has tables is never reloaded. Pending migrations in
   this directory are applied instead.

Applied migrations are recorded in the MySQL table
`fracto_schema_migrations`, including a SHA-256 checksum. Existing installations
are recorded at `001_baseline.sql` without replaying the original dumps.

New checksums normalize CRLF to LF. Existing LF or CRLF fingerprints are accepted
only when they match a byte-for-byte line-ending variant of the current SQL file.
This permits Windows/Linux checkouts to agree without replaying migrations or
rewriting old history. SQL, comments, and other whitespace changes still fail the
applied-migration guard and require a new migration.

`011_sync-baseline-tables.sql` adds empty lore tables missing in some legacy
databases and places `videos.archived` after `script_version`, matching the
shared baseline. It preserves existing rows, is replay-safe, and loads no content.
The runner applies the same server-capability collation fallback to pending
migrations as to backup imports. Where MySQL 8's `utf8mb4_0900_ai_ci` is absent,
011's execution copy uses the supported `utf8mb4_unicode_520_ci` collation.
The file and its checksum stay unchanged. Retry the normal migration command;
successful migrations 006–010 are skipped and 011 can safely retry partial DDL.

## Create a migration

Choose the next unused, zero-padded number and a short description. The filename
must match `NNN_description.sql` and migrations are run in lexical order:

```text
002_add_asset_status.sql
003_add_asset_lookup_index.sql
```

Write ordinary MySQL DDL. Typical changes look like this:

```sql
-- Add a table
CREATE TABLE asset_tags (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  asset_id BIGINT NOT NULL,
  tag VARCHAR(100) NOT NULL
);

-- Add a nullable column while old rows remain valid
ALTER TABLE assets ADD COLUMN status VARCHAR(32) NULL;

-- Add an index for a new query path
CREATE INDEX assets_status_idx ON assets (status);
```

Use the real table and column definitions from the target schema. For changes
that may run against partially updated installations, use compatible,
idempotent SQL where MySQL supports it (`IF NOT EXISTS`, nullable columns,
backfills followed by a later `NOT NULL` constraint, and so on). Avoid dropping
data in a migration. A destructive correction should be designed as a staged
backup/rename process and reviewed separately.

### Refresh a table from a downloaded dump

For a new table-data dump that contains `DROP TABLE`, `CREATE TABLE`, and `INSERT`
statements, do not run the dump directly against an existing database. Instead, add
a numbered migration containing this directive:

```sql
-- FRACTO-BACKUP-REFRESH: free_bailiwicks.sql AS free_bailiwicks
```

The referenced file must be in `backup/`. The initializer extracts its `INSERT`
statement and performs an `INSERT ... ON DUPLICATE KEY UPDATE` against the existing
table. Existing rows are updated or retained, new rows are inserted, and rows absent
from the dump are not deleted. On an empty database, bootstrap already loads the dump
and the migration is recorded without repeating the refresh.

## Test and apply

Before committing a migration, run the static validator:

```powershell
npm run db:validate
```

Validation requires `001_baseline.sql`, enforces the numbered filename format,
rejects duplicate numeric versions and empty files, and blocks `DROP DATABASE`
and `TRUNCATE` statements. CI runs the same check automatically. This does not
replace testing the migration against a disposable MySQL database.

Review the SQL, then run the normal database command from the repository root:

```powershell
npm run db:migrate
```

For Docker production, rebuild if the migration script changed and run the
maintenance service:

```powershell
docker compose build fracto
docker compose run --build --rm database-init
```

The Windows wrapper is:

```powershell
.\scripts\reset-database.bat
```

Despite its historical filename, this wrapper only applies pending migrations;
it does not reset or drop tables. The first-run script invokes the same safe
bootstrap/migration operation automatically.

The command can be rerun after a failure. Successfully recorded migrations are
skipped, and their checksums are verified. If a migration fails part-way through
(some MySQL DDL implicitly commits), inspect the database before retrying and
create a corrective migration if necessary. Never edit an already-applied file:
the checksum guard intentionally rejects that.

### Redo an applied migration

When an already-applied migration must be deliberately replayed, use its numeric
prefix with the Windows wrapper:

```powershell
.\scripts\redo-migration.bat 002
```

The wrapper confirms the operation, rebuilds the image, and runs the initializer
with `--force 002`. The matching migration is executed again and its history row
is updated. All other migrations remain skipped. Forced migrations must be
idempotent: use `IF EXISTS`/`IF NOT EXISTS`, upserts, or equivalent guards so a
second execution is safe. The command does not provide automatic undo or delete
application data.

Keep migration files in source control and deploy them together with the code
that requires the schema. Do not put credentials or data dumps in this
directory; secrets remain under the ignored `config/` directory and bootstrap
data remains under `backup/`.

## Migration 003: minibrot ray geometry

`003_minibrot-ray-paths.sql` adds nullable `free_bailiwicks.ray_paths` JSON.
Existing rows and timestamps are preserved. The information_schema guard makes
recovery safe if column creation committed before migration-history recording.
Do not alter migrations 001 or 002, whose recorded checksums must remain valid.
The initializer now holds a database-specific advisory lock while checking and
applying migrations, including bootstrap, so servers sharing a database wait
rather than race. Each distinct database still requires its own migration run.

The backup-refresh implementation names the original dump columns explicitly.
Replaying an old dump therefore preserves later-added columns such as ray_paths;
it no longer attempts an incompatible positional insert into the expanded table.

Validation can also run directly with `node scripts/validate_migrations.js`.
Apply with `node scripts/initialize_database.js` from the configured root, or
use the existing Docker database-init/deployment commands above. Deploy/restart
the matching data service after migration; old records remain readable before
any paths have been generated. See [the ray cache guide](../../sdk/orbitals/RAY_CACHE.md)
for API/schema compatibility, storage bounds and the separate numerical basis.

## Migration 004: curated WordNet mappings

`004_wordnet-mappings.sql` creates `wordnet_mappings` and seeds the 318 curated
worlds associations. Cardinality is the primary key; the eight-character WordNet
synset ID is unique and retains leading zeroes. Rows include WordNet version,
word, short definition, full gloss, numeric factorization, explanatory notes,
and creation/update timestamps. All cardinalities 1 through 256 are included.

The snapshot combines WorldsFirstRound, WorldsGapFill and WorldsCompounds with
WorldsContenders in the UI repository. It includes the WordNet license. Existing
rows and notes are preserved on reruns. Browser-local note edits are not imported,
and the UI now reads the table through the data service mappings endpoint.

Never regenerate this migration after application. Schema changes and new
versioned snapshots require a new migration. Routine world_name and notes edits
now use POST /data/request. The generator and snapshot test document and verify the
initial conversion; update the test deliberately when introducing a later snapshot.

## Migration 005: world names

`005_world-names.sql` adds `wordnet_mappings.world_name` as VARCHAR(255), NOT NULL.
Existing blank names are initialized as `world N` using the row cardinality.
The column guard permits safe replay and existing nonblank names are preserved.
Backfilling does not change existing timestamps. Future inserts should provide
world_name explicitly. Migration 004 remains unchanged.

## Migration 006: unapproved world-name suggestions

`006_world-name-suggestions.sql` appends 375 suggestions across all 318 worlds;
57 worlds have a second alternative. Each suggestion includes a brief theme-based
reason. Existing notes are retained before the appended section. Rows match both
cardinality and synset, and a marker prevents repeated additions. No names,
cardinalities, senses or associations change. See ../seeds/README.md for proposal
sources and reference checks. Do not regenerate 006 after application.

The migration runner explicitly collates both operands of 006's `LOCATE`
marker check to `utf8mb4_unicode_ci` in its execution copy. This avoids mixed
implicit collations on servers that default generated UTF-8 expressions to
`utf8mb4_general_ci`. The migration file, seed data and checksum are unchanged.
After updating the runner, retry `npm run db:migrate` normally; do not force
reapply successful migrations or edit their recorded checksums.

## Migration 009: survey discovery evidence

`009_orbital-survey-metadata.sql` adds nullable JSON `discovery_metadata` to
`orbital_progressions` and `orbital_discovery_results` with replay guards.
It records the shared Seed Surveys scan's rank, confidence, discovery counts,
seed and numerical settings. Older rows remain null; no backfill, coordinate
replacement or source-table change occurs. Apply before running v2 discovery.

## Migration 010: resumable orbital jobs

`010_orbital-resume-checkpoints.sql` adds nullable execution_token and a
resume_count to discovery runs and creates orbital_discovery_checkpoints with
a compressed, versioned payload. Definitions are replay-safe. Existing points,
ratios and run history are preserved; no checkpoint/data backfill occurs. Apply
before deploying the resumable worker coordinator. Legacy stopped runs cannot
reconstruct work that was never checkpointed and must restart once.

## Migration 012: persistent Julia ray paths

`012_orbital-ray-paths.sql` creates `orbital_ray_paths`, keyed by orbital ID with
a foreign key to `orbital_progressions`. Its JSON document stores versioned,
validated dynamic-ray geometry and accuracy metadata, optionally compressed by
the existing ray codec. Loading is lazy and successful traces populate the cache;
there is no backfill. This table is independent of minibrot parameter-ray paths.
