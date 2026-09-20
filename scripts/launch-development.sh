#!/bin/sh

set -eu

repository_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repository_dir"
node scripts/sync_bluesky_media.js --allow-failure
node scripts/write_build_info.js
scripts/ensure_exclusive.sh dev

exec docker compose -f compose.yaml -f compose.dev.yaml up --build --renew-anon-volumes fracto-dev
