#!/bin/sh

set -eu

repository_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repository_dir"

exec docker compose -f compose.yaml -f compose.dev.yaml up --build fracto-dev
