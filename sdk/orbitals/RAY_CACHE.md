# Persistent minibrot ray paths

Calculated parameter rays are cached on their `free_bailiwicks` record in the
nullable `ray_paths` JSON column. This is server-backed shared storage, not
browser-local IndexedDB. Minibrot list requests exclude geometry; selecting a
freeform record retrieves its paths through a separate endpoint.

## Contract and ownership

`FractoMinibrotRayCache.js` owns the version, canonical coordinate identity,
validation, group quality comparison, tolerance eligibility and visible result
assembly. It performs no network or database operations. Bump
`RAY_CACHE_VERSION` whenever solver changes invalidate cached geometry or its
quality assumptions; label, color and table-layout changes do not require it.

A cache document contains:

- `version`, canonical decimal-string `core_point` and integer `period`.
- `groups` keyed by `root_access`, `doubling`, `1/3`, `2/3`, `antenna_tip`.
- Each entry's `tolerance`, complete SDK `result`, and `computed_at` timestamp.
- A document `updated_at` timestamp independent of the minibrot's own dates.

Results retain global reduced angle strings, target coordinates including exact
metadata, accepted point arrays, completion flags, endpoint errors and solver
diagnostics. Display-only exponential labels are recreated by the UI. Color,
selection, canvas focal point and canvas size are not part of geometry identity.
Requested tolerance is retained because current tracing stops at that accuracy.

Core strings are normalized without Number rounding. A version/core/period
mismatch is a cache miss. The server also compares writes with the current
record under a row lock; a changed core or period returns 409, preventing a
late result from contaminating a different record state.

## Quality, reuse and calculation

A completed group is reusable only when its stored requested tolerance is no
larger than the current tolerance and every landed ray's recorded endpoint
error meets the new request. This is conservative: a lucky endpoint from a
coarser request alone does not establish the required calculation quality.

Writes merge groups independently. Completed groups beat incomplete/failed
ones. Between completed entries, finer requested tolerance wins, with endpoint
error breaking ties. Incomplete results prefer more landed partners, then more
paths, then more accepted points. Failures with no paths can retain diagnostic
metadata but are never permanent negative-cache hits: they are retried later.

`find_minibrot_rays` accepts optional `cache` and `on_group(id,result)` options.
Compatible complete groups skip calculation. Each newly calculated group emits
`on_group` before subsequent groups run. Cached partial/coarser paths remain
available while missing or insufficient groups calculate. A cached complete
result that does not meet a tighter request is displayed as incomplete, with
landing flags cleared for that request; its better-known stored quality is
not destroyed by a failed refinement attempt.

The browser worker posts group messages as calculations finish. The UI's
`MinibrotRayStorage` queues per-group saves, binding them to an immutable record
identity. Saves already queued continue after unmount; stale reads/results
cannot repaint the next selection. A failed save does not prevent subsequent
queued groups from being attempted. The final worker message still assembles
the full result as before.

## HTTP and storage

The data server owns the authenticated routes:

- `GET /minibrot/:id/ray-paths` returns `{result: cacheOrNull}` for that record.
- `PUT /minibrot/:id/ray-paths` accepts `{version,core_point,period,tolerance,
group,result}` and returns a small save acknowledgement, not the full paths.

The normal enabled-user middleware applies when authentication is configured.
IDs, canonical fractions, finite points, completion quality, partner counts and
payload sizes are validated. Completed endpoints must lie within tolerance.
These are structural/numerical sanity checks; the server does not recalculate
or mathematically certify client-generated rays.

PUT uses a database transaction and `SELECT ... FOR UPDATE` before merging and
changing `ray_paths` and explicitly retaining `updated_at`. Concurrent clients cannot erase other groups or
replace a completed group with a failed result. Geometry does not inflate
`GET /minibrots` or the generic free_bailiwicks query; their explicit column
projection works before and after the
schema migration. List filters accept only the existing 0/1 flag values.

Individual group requests are limited to 20 MiB, within the default 25mb JSON
body limit. Whole documents allow 96 MiB uncompressed. Small caches remain
plain JSON; at 1 MiB the service asynchronously gzips the document into a
`{encoding:"gzip-base64",data:...}` JSON envelope. Encoded storage is capped
at 20 MiB and decompression is bounded to 96 MiB. The codec transparently reads
either representation; HTTP callers always receive the ordinary cache contract.
These limits may also be constrained by a deployment's MySQL packet/proxy limits.
Failures preserve the current displayed geometry and produce a save message.

## UI and migration rollout

The component first reads paths for the selected record, with a five-second
lookup timeout. A fully sufficient cache paints immediately without creating a
worker. Otherwise saved paths paint while the worker fills gaps. Registered
messages distinguish loading, loaded, saving, saved and failed persistence;
the existing stage and elapsed calculation messages remain active when needed.
Storage unavailability falls back to calculation rather than blanking the view.

Migration `003_minibrot-ray-paths.sql` adds only a nullable JSON column. Its
information_schema check makes a rerun safe after DDL succeeded but history
recording failed. Existing records, IDs and minibrot timestamps remain intact.
The initializer takes a database-specific advisory lock, preventing servers
sharing a database from racing migration checks or bootstrap.

Deploy the root SDK/migration, data-server routes and UI together through the
existing deployment process. Run `node scripts/validate_migrations.js`, then
`node scripts/initialize_database.js` for each configured database; the Docker
`database-init` service and existing deployment scripts invoke this initializer.
Restart/redeploy the data service to register the new routes. A server awaiting
migration returns 503 with `ray_cache_schema_pending`; the UI still calculates.
A shared database only needs the migration once; separate databases each need
it. Applying it to one configured database does not migrate unrelated hosts.

Old dump refreshes now name the dump's original columns. Replaying refresh 002
therefore preserves a later-added cache column instead of failing due to a
column-count mismatch or overwriting it. Existing migration files are not
edited, preserving checksum verification.

## Verification and mathematical basis

Cache tests cover exact identity, version invalidation, accuracy reuse,
completed/partial merging, SDK skip behavior, row-lock concurrency, changed
records, missing schema, compression and safe old-dump refreshes. UI tests cover
cache-only loads, incremental saves, offline fallback, save ordering and stale
selection callbacks. An opt-in MySQL integration test writes only temporary
fixture rows and checks real JSON and compressed geometry persistence:
`FRACTO_DB_INTEGRATION=1 node --test test/minibrot_ray_paths.integration.test.js`.

Caching introduces no new ray theory. The saved geometry remains the numerical
approximation described in [PARAMETER_RAYS.md](PARAMETER_RAYS.md),
[SATELLITE_RAYS.md](SATELLITE_RAYS.md), [ANTENNA_RAYS.md](ANTENNA_RAYS.md) and
[PARAMETER_PRECISION.md](PARAMETER_PRECISION.md). The published theoretical
basis remains [Milnor (2000), sections 3, 6 and 8](https://numdam.org/item/AST_2000__261__277_0/)
and [Schleicher (2000)](https://numdam.org/item/AST_2000__261__405_0/).
Persistence and a completed numerical flag do not certify mathematical landing.
