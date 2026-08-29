#!/usr/bin/env sh
set -eu
repository_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repository_dir"
target=${1:-both}
case "$target" in prod|dev|both) ;; *) echo 'Usage: scripts/shutdown.sh [dev|prod]' >&2; exit 2 ;; esac
prod_running=$(docker compose ps --status running -q fracto 2>/dev/null || true)
dev_running=$(docker compose -f compose.yaml -f compose.dev.yaml ps --status running -q fracto-dev 2>/dev/null || true)
[ "$target" = dev ] && prod_running=''
[ "$target" = prod ] && dev_running=''
if [ -z "$prod_running" ] && [ -z "$dev_running" ]; then
  echo 'No requested Fracto server is running.'
  exit 0
fi
running=''
[ -n "$prod_running" ] && running='production'
if [ -n "$dev_running" ]; then
  [ -n "$running" ] && running="$running and "
  running="${running}development"
fi
printf 'Stop the running %s server(s) gracefully? [y/N] ' "$running"
read -r answer
case "$answer" in [yY]|[yY][eE][sS]) ;; *) echo 'Shutdown cancelled.'; exit 0 ;; esac
[ -z "$prod_running" ] || docker compose stop fracto
[ -z "$dev_running" ] || docker compose -f compose.yaml -f compose.dev.yaml stop fracto-dev
echo 'Requested Fracto server(s) stopped.'
