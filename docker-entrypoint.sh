#!/bin/sh
set -eu

mkdir -p "$FRACTO_TILE_DATA_DIR" "$FRACTO_TILE_INDEX_DIR" /app/assets /app/logs

starts_fracto=false
if [ "${1:-}" = "node" ]; then
  for argument in "$@"; do
    if [ "$argument" = "index.js" ]; then
      starts_fracto=true
    fi
  done
fi

if [ "$starts_fracto" = "true" ]; then
  if [ ! -s "$FRACTO_TILE_INDEX_DIR/CURRENT" ]; then
    echo "No completed tile index generation is installed."
    echo "Run: docker compose run --rm index-refresh"
    exit 1
  fi
fi

exec "$@"
