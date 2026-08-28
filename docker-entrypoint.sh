#!/bin/sh
set -eu

mkdir -p "$FRACTO_TILE_DATA_DIR" "$FRACTO_TILE_INDEX_DIR" /app/assets /app/logs

if [ "${1:-}" = "node" ] && [ "${2:-}" = "--max-old-space-size=16384" ]; then
  if [ ! -s "$FRACTO_TILE_INDEX_DIR/CURRENT" ]; then
    echo "No completed tile index generation is installed."
    echo "Run: docker compose run --rm index-refresh"
    exit 1
  fi
fi

exec "$@"
