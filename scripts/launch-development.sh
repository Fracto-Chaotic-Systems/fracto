#!/bin/sh

set -eu

repository_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repository_dir"
scripts/ensure_exclusive.sh dev

exec docker compose -f compose.yaml -f compose.dev.yaml up --build fracto-dev
