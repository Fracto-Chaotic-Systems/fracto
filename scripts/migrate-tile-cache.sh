#!/bin/sh

set -eu

repository_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repository_dir"

docker compose -f compose.yaml -f compose.dev.yaml stop fracto fracto-dev
exec docker compose run --rm tile-cache-migrate
