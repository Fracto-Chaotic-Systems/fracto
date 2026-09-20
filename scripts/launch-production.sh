#!/bin/sh

set -eu

repository_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repository_dir"
node scripts/sync_bluesky_media.js --allow-failure
node scripts/write_build_info.js
scripts/ensure_exclusive.sh prod

exec docker compose up --build -d fracto
