#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIRECTORY"

MODE="${1:-}"
if [[ "$MODE" != "first-run" && "$MODE" != "update" ]]; then
  echo "Usage: bash scripts/ec2_deploy.sh [first-run|update]" >&2
  exit 2
fi

for command_name in git node npm docker; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required command not found: $command_name" >&2
    exit 1
  }
done
[[ "$(uname -s)" == Linux ]] || {
  echo "This workflow is for Linux EC2 hosts." >&2
  exit 1
}
docker compose version >/dev/null 2>&1 || {
  echo "Docker Compose v2 is required (docker compose)." >&2
  exit 1
}

COMPOSE=(docker compose -f compose.yaml -f compose.local-tiles.yaml)
PREPARE_COMPOSE=(docker compose -f compose.yaml -f compose.local-tiles.yaml -f compose.local-tiles-prepare.yaml)

if [[ ! -f .env || ! -f config/mysql.json ]]; then
  echo "Create the protected .env and config/mysql.json files before deployment." >&2
  exit 1
fi

echo "Checking Compose syntax and validating protected settings before repository updates..."
"${COMPOSE[@]}" config --quiet
node scripts/validate_ec2_deployment.js
SOURCE_DIRECTORY="$(node scripts/validate_ec2_deployment.js --source-dir)"

# Clone only missing service repositories. Existing non-Git directories are
# treated as an installation error instead of being overwritten.
if [[ -n "${FRACTO_SERVICE_REPOSITORY_BASE_URL:-}" ]]; then
  REPOSITORY_BASE="${FRACTO_SERVICE_REPOSITORY_BASE_URL%/}"
else
  ROOT_REMOTE="$(git remote get-url origin 2>/dev/null || true)"
  if [[ -z "$ROOT_REMOTE" ]]; then
    echo "Cannot infer the service repository base URL; set FRACTO_SERVICE_REPOSITORY_BASE_URL." >&2
    exit 1
  fi
  REPOSITORY_BASE="${ROOT_REMOTE%/fracto.git}"
  REPOSITORY_BASE="${REPOSITORY_BASE%/fracto}"
  if [[ "$REPOSITORY_BASE" == "$ROOT_REMOTE" ]]; then
    echo "Root origin must end in /fracto or /fracto.git; set FRACTO_SERVICE_REPOSITORY_BASE_URL." >&2
    exit 1
  fi
fi

SERVICE_REPOSITORIES=(
  fracto-admin-server
  fracto-asset-server
  fracto-data-server
  fracto-tiles-server
  fracto-ui
)
mkdir -p servers
for repository in "${SERVICE_REPOSITORIES[@]}"; do
  repository_path="servers/$repository"
  if [[ -d "$repository_path/.git" || -f "$repository_path/.git" ]]; then
    continue
  fi
  if [[ -e "$repository_path" ]]; then
    echo "$repository_path exists but is not a Git checkout; move it aside and retry." >&2
    exit 1
  fi
  echo "Cloning $repository..."
  git clone "${REPOSITORY_BASE%/}/$repository.git" "$repository_path"
done

echo "Fast-forwarding the root and five service repositories..."
npm run update:repos

echo "Validating production Compose settings and protected configuration..."
"${COMPOSE[@]}" config --quiet
node scripts/validate_ec2_deployment.js
SOURCE_DIRECTORY="$(node scripts/validate_ec2_deployment.js --source-dir)"

if [[ "$MODE" == "update" && ! -f "$SOURCE_DIRECTORY/fracto-tile-release.json" ]]; then
  echo "The local tile release manifest is missing. Complete first-run tile pairing before updating." >&2
  exit 1
fi

echo "Building the complete Fracto production image..."
"${COMPOSE[@]}" build fracto

echo "Ensuring production is the only active Compose mode before database work..."
bash scripts/ensure_exclusive.sh prod
"${COMPOSE[@]}" stop fracto

if [[ "$MODE" == "first-run" && ! -f "$SOURCE_DIRECTORY/fracto-tile-release.json" ]]; then
  echo "Preparing the database..."
  "${COMPOSE[@]}" run --rm database-init

  echo "Building a candidate tile index from the configured indexed manifest..."
  "${COMPOSE[@]}" run --rm index-refresh

  echo "Checking a representative local tile and publishing its pairing manifest..."
  "${PREPARE_COMPOSE[@]}" run --rm --no-deps --entrypoint node fracto scripts/create_tile_source_release_manifest.js
else
  echo "Preparing the database and applying pending migrations..."
  "${COMPOSE[@]}" run --rm database-init
fi

echo "Running full-stack startup preflight, including local tile pairing and MySQL..."
"${COMPOSE[@]}" run --rm --no-deps --entrypoint node fracto scripts/startup_preflight.js

echo "Starting the complete supervised stack..."
"${COMPOSE[@]}" up -d --wait --wait-timeout 300 fracto

echo "EC2 $MODE workflow completed. The fracto container supervises all five services."
