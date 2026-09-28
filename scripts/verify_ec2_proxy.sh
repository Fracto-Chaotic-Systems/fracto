#!/usr/bin/env bash
set -Eeuo pipefail

ORIGIN="${1:-}"
if [[ "$ORIGIN" != https://* ]]; then
  echo "Usage: bash scripts/verify_ec2_proxy.sh https://public-host[:port]" >&2
  exit 2
fi
ORIGIN="${ORIGIN%/}"

for command_name in curl docker sha256sum node; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required command not found: $command_name" >&2
    exit 1
  }
done

ROOT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIRECTORY"
COMPOSE=(docker compose -f compose.yaml -f compose.local-tiles.yaml)
TEMP_DIRECTORY="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIRECTORY"' EXIT

echo "Checking that the full supervised application is ready..."
curl --fail --silent --show-error --max-time 15 "$ORIGIN/api/main/readyz" \
  --output "$TEMP_DIRECTORY/readiness.json"
node --input-type=module - "$TEMP_DIRECTORY/readiness.json" <<'NODE'
import fs from 'node:fs'
const body = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
if (body.status !== 'ready') process.exit(1)
NODE

echo "Checking the public UI..."
curl --fail --silent --show-error --max-time 15 "$ORIGIN/" \
  --output "$TEMP_DIRECTORY/ui.html"
grep -Eiq '<!doctype html|<html' "$TEMP_DIRECTORY/ui.html" || {
  echo "The public UI route did not return an HTML document." >&2
  exit 1
}

declare -a ROUTES=(
  "main 3001 /api/main"
  "data 3002 /api/data"
  "asset 3003 /api/asset"
  "tiles 3004 /api/tiles"
  "admin 3005 /api/admin"
)
PROBE_PATH="/__fracto_proxy_probe_$(date +%s)_$$"

echo "Checking each nginx API route against its loopback service..."
for route in "${ROUTES[@]}"; do
  read -r service port prefix <<< "$route"
  direct_status="$(curl --silent --show-error --max-time 15 \
    --output "$TEMP_DIRECTORY/$service.direct" --write-out '%{http_code}' \
    "http://127.0.0.1:$port$PROBE_PATH")"
  proxy_status="$(curl --silent --show-error --max-time 15 \
    --output "$TEMP_DIRECTORY/$service.proxy" --write-out '%{http_code}' \
    "$ORIGIN$prefix$PROBE_PATH")"
  direct_hash="$(sha256sum "$TEMP_DIRECTORY/$service.direct" | cut -d ' ' -f 1)"
  proxy_hash="$(sha256sum "$TEMP_DIRECTORY/$service.proxy" | cut -d ' ' -f 1)"
  if [[ "$proxy_status" != "$direct_status" || "$proxy_hash" != "$direct_hash" ]]; then
    echo "nginx route $prefix did not match the $service service response (HTTP $proxy_status vs $direct_status)." >&2
    exit 1
  fi
  echo "  $prefix -> 127.0.0.1:$port passed (HTTP $proxy_status)."
done

echo "Checking host bindings are loopback-only..."
for port in 3001 3002 3003 3004 3005 3006; do
  binding="$("${COMPOSE[@]}" port fracto "$port")"
  if [[ -z "$binding" || "$binding" == *$'\n'* || "$binding" != 127.0.0.1:* ]]; then
    echo "Port $port is not bound exclusively to 127.0.0.1 (reported: $binding)." >&2
    exit 1
  fi
done

echo "EC2 integration probes passed: readiness, UI, five API routes, and private host ports."
