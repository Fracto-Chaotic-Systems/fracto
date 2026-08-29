#!/bin/sh

set -eu

repository_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repository_dir"
scripts/ensure_exclusive.sh prod

exec docker compose up --build -d fracto
