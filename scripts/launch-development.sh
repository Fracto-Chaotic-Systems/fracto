#!/bin/sh

set -eu

repository_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repository_dir"
node scripts/write_build_info.js
scripts/ensure_exclusive.sh dev

node scripts/windows_host_startup.js --port 3101
# Apply pending database migrations (root and service-owned) from the working
# tree before starting, as cold_boot does. A failed migration stops the launch.
docker compose -f compose.yaml -f compose.dev.yaml build fracto-dev
echo "Applying pending database migrations..."
if ! docker compose -f compose.yaml -f compose.dev.yaml run --rm --no-deps fracto-dev node scripts/migrate_database.js; then
  echo "Database migrations failed; development stack not started. See the output above." >&2
  exit 1
fi
exec docker compose -f compose.yaml -f compose.dev.yaml up --renew-anon-volumes fracto-dev
