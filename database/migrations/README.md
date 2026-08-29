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

Keep migration files in source control and deploy them together with the code
that requires the schema. Do not put credentials or data dumps in this
directory; secrets remain under the ignored `config/` directory and bootstrap
data remains under `backup/`.
