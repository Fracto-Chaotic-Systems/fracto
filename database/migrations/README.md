# Database migrations

The initializer has two modes:

1. An empty database is bootstrapped from the read-only SQL dumps in `backup/`.
2. A database that already has tables is never reloaded. Pending migrations in
   this directory are applied instead.

Applied migrations are recorded in the MySQL table
`fracto_schema_migrations`, including a SHA-256 checksum. Existing installations
are recorded at `001_baseline.sql` without replaying the original dumps.

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
