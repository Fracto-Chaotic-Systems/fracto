#!/usr/bin/env sh
set -eu

target=${1:-}
case "$target" in
  prod)
    other=$(docker compose -f compose.yaml -f compose.dev.yaml ps --status running -q fracto-dev 2>/dev/null || true)
    if [ -z "$other" ]; then exit 0; fi
    printf 'Development server is running. Stop it gracefully before launching production? [y/N] '
    read -r answer
    case "$answer" in [yY]|[yY][eE][sS]) docker compose -f compose.yaml -f compose.dev.yaml stop fracto-dev ;; *) exit 1 ;; esac
    ;;
  dev)
    other=$(docker compose ps --status running -q fracto 2>/dev/null || true)
    if [ -z "$other" ]; then exit 0; fi
    printf 'Production server is running. Stop it gracefully before launching development? [y/N] '
    read -r answer
    case "$answer" in [yY]|[yY][eE][sS]) docker compose stop fracto ;; *) exit 1 ;; esac
    ;;
  *) echo 'Usage: scripts/ensure_exclusive.sh [prod|dev]' >&2; exit 2 ;;
esac
