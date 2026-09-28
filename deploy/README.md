# Deployment examples

This directory contains deployment-facing examples for the main Fracto
repository. Keep real hostnames, certificates, secrets, and machine-specific
paths in the deployment environment; do not commit them.

## nginx for the public EC2 host

The example in `nginx/fracto.conf.example` serves
`https://fracto.mikehallstudio.com:3000`. It assumes nginx terminates TLS and
the production Compose stack publishes the existing service ports on the same
EC2 host. Install the companion header snippet as
`/etc/nginx/snippets/fracto-proxy-headers.conf`, then install and enable the
server block through the host's normal nginx configuration. Replace the
certificate paths if the current certificate uses another location.

Before reloading nginx, run `sudo nginx -t`. Then use the host's normal reload
command. Confirm the EC2 security group and host firewall allow inbound HTTPS
on TCP 3000 and do not allow public access to service ports 3001-3006. The
nginx-to-service connections use loopback HTTP.
Production Compose also binds all six application ports to `127.0.0.1`, so
nginx on the EC2 host can reach them while remote clients cannot connect to
those ports directly.

The UI selects same-origin API paths when opened outside the local UI ports
3006 and 3106. The example maps `/api/main/`, `/api/admin/`,
`/api/data/`, `/api/asset/`, and `/api/tiles/` to the corresponding
localhost listeners and removes the prefix before forwarding the request.
Unknown `/api/` paths return 404. Local development keeps its current
direct-port behavior.

Configure the root deployment's ignored `.env` with the exact public origin
and callback:

```dotenv
FRACTO_UI_ORIGIN=https://fracto.mikehallstudio.com:3000
FRACTO_OIDC_REDIRECT_URI=https://fracto.mikehallstudio.com:3000/api/main/auth/callback
FRACTO_AUTH_SECURE_COOKIES=true
FRACTO_AUTH_REQUIRED=true
```

Use the registered Google OIDC client ID, client secret, and issuer in the same
protected environment file or secret store. Register the callback URL above
exactly in the OIDC provider configuration. The public callback follows the
`/api/main/` route, which nginx strips before sending it to the main server.

The application should continue listening on its existing internal service
ports. The proxy headers preserve the public host and HTTPS scheme. The
application's configured public origin remains the authority for redirects,
origin checks, and secure session cookies.

## EC2 local tile source

When this EC2 host stores the authoritative tile corpus, enable the opt-in
Compose overlay `compose.local-tiles.yaml`. The ordinary `compose.yaml` keeps
the remote-cache mode as its default. The overlay mounts the selected host
generation read-only at `/mnt/fracto-tile-source` in the `fracto` container,
sets the local source mode and generation, and leaves the existing tile
listener on port 3004. The nginx `/api/tiles/` location above continues to
proxy to that same listener.

Set these deployment-specific, non-secret values in the root `.env` on EC2:

```dotenv
FRACTO_TILE_SOURCE_HOST_DIR=/srv/fracto/tiles
FRACTO_TILE_SOURCE_GENERATION=production-tiles-v1
```

The host path must already exist and contain the permanent tile corpus. The
tile files stay at this path; a new physical directory is not needed for every
index build. The container path is fixed by the overlay. The value of
`FRACTO_TILE_SOURCE_GENERATION` is a logical, non-secret dataset/index ID. Keep
it while the corpus/index pairing is unchanged, and change it if that pairing
changes. Ensure the Docker service can read and traverse the host directory;
the container receives no write access to it. Keep the path and identifier in
the deployment `.env`, not Git.

### First installation and later updates

Install Git, Node.js/npm, and Docker Compose v2 on the EC2 host. Clone the main
repository, copy the deployment's protected `.env` and `config/*.json` files
into place, and ensure the permanent tile directory is mounted and readable
by Docker. The deployment validator requires `.env` mode `600`, owned by the
account running the workflow, and config files readable by container UID or
GID 1000 without world access. For example:

```sh
chmod 600 .env
sudo chown root:1000 config/*.json
sudo chmod 640 config/*.json
```

Set the production OIDC values and local-source settings from the preceding
sections, then run:

```sh
npm run deploy:ec2:first-run
```

The workflow validates the merged Compose model and protected files before it
updates repositories. Missing `servers/fracto-*` checkouts are cloned from the
same repository base as the main checkout; private-repository credentials must
be configured through SSH or Git's credential helper. Existing checkouts are
fast-forwarded only, and tracked local changes or divergent histories stop the
workflow.

On first install, the workflow builds the production image and runs the
non-destructive database bootstrap/migration command. If the tile directory
does not yet have `fracto-tile-release.json`, it refreshes a candidate index
from the configured indexed manifest, then checks the complete tile filename
inventory against the compiled index before creating that manifest. The exact
inventory check can take a long time on a corpus of tens of millions of files.
If a manifest already exists, first-run preserves it; the full-stack preflight
checks that its source identifier, index fingerprint, and tile count still
match.

For subsequent releases, use:

```sh
npm run deploy:ec2:update
```

Update fast-forwards the repositories, validates the existing release
manifest, rebuilds the image, gracefully stops the supervisor before applying
pending database migrations, runs the full-stack preflight, and starts
`fracto`. It never refreshes the tile index. The `fracto` container launches
the main server and supervises the five dependent services; the workflow does
not run the standalone tile-server launcher. Existing named volumes are
preserved.

If an install or update stops on validation, fix the reported configuration or
deployment issue and rerun the same command. If the tile source/index pairing
must change, use the documented release-preparation process to select a
matching completed index and create a new exact-inventory attestation before
deploying. Do not edit an existing release manifest by hand.

### Publish a tile release and rollback

Keep the active source and index immutable. Prepare each new source under a
separate host path such as `/srv/fracto/tile-releases/production-tiles-v2`.
Use an EBS/filesystem snapshot or another copy-on-write method when the tile
contents are unchanged; do not modify the active tree in place. The candidate
root must have the normal `LNN/<short-code>.gz` layout and be writable by the
container's node user only while its release manifest is created. Make it
read-only after that step.

Before building, record the current `FRACTO_TILE_SOURCE_HOST_DIR`,
`FRACTO_TILE_SOURCE_GENERATION`, and the selected index generation. Read the
index generation without printing other container environment values:

```sh
docker compose -f compose.yaml -f compose.local-tiles.yaml run --rm --no-deps \
  --entrypoint node fracto -e "process.stdout.write(require('fs').readFileSync('/var/lib/fracto/index/CURRENT', 'utf8').trim())"
```

Create a temporary Compose env file containing only the candidate's two
non-secret tile settings. Pass the protected production `.env` first and this
file second so its two values override the active pair for preparation without
copying OIDC secrets:

```sh
CANDIDATE_ENV="$(mktemp)"
chmod 600 "$CANDIDATE_ENV"
cat > "$CANDIDATE_ENV" <<'EOF'
FRACTO_TILE_SOURCE_HOST_DIR=/srv/fracto/tile-releases/production-tiles-v2
FRACTO_TILE_SOURCE_GENERATION=production-tiles-v2
EOF
```

Build a complete candidate index without changing the active `CURRENT` pointer:

```sh
docker compose --env-file .env --env-file "$CANDIDATE_ENV" \
  -f compose.yaml -f compose.local-tiles.yaml \
  run --rm -e FRACTO_TILE_INDEX_PUBLISH_CURRENT=false index-refresh
```

Record the generation ID from the final `Prepared complete tile index
generation ... without changing CURRENT` line. Then create the candidate
manifest and run the full startup preflight against that exact index directory
and candidate source. The preflight also checks the production database and
all five dependent service packages inside the production image:

```sh
INDEX_GENERATION='<prepared-generation-id>'
INDEX_DIR="/var/lib/fracto/index/generations/$INDEX_GENERATION"
docker compose --env-file .env --env-file "$CANDIDATE_ENV" \
  -f compose.yaml -f compose.local-tiles.yaml -f compose.local-tiles-prepare.yaml \
  run --rm --no-deps -e "FRACTO_TILE_INDEX_GENERATION_DIR=$INDEX_DIR" \
  --entrypoint node fracto scripts/create_tile_source_release_manifest.js
docker compose --env-file .env --env-file "$CANDIDATE_ENV" \
  -f compose.yaml -f compose.local-tiles.yaml \
  run --rm --no-deps -e "FRACTO_TILE_INDEX_GENERATION_DIR=$INDEX_DIR" \
  --entrypoint node fracto scripts/startup_preflight.js
```

The manifest command checks every short code against the candidate `.gz` file
inventory and refuses an existing manifest. Preflight validates its generation,
fingerprint, tile count, and representative tile. The existing production
`CURRENT` and running application still use the previous index throughout this
candidate preparation.

After candidate preflight succeeds, make the candidate source root read-only.
Stop the supervisor, update the two tile settings in the protected root `.env`
as one change, then atomically select the candidate index generation:

```sh
docker compose -f compose.yaml -f compose.local-tiles.yaml stop fracto
# Edit FRACTO_TILE_SOURCE_HOST_DIR and FRACTO_TILE_SOURCE_GENERATION together in .env.
docker compose -f compose.yaml -f compose.local-tiles.yaml run --rm --no-deps \
  --entrypoint node fracto scripts/select_tile_index_generation.js "$INDEX_GENERATION"
docker compose -f compose.yaml -f compose.local-tiles.yaml run --rm --no-deps \
  --entrypoint node fracto scripts/startup_preflight.js
docker compose -f compose.yaml -f compose.local-tiles.yaml up -d --wait --wait-timeout 300 fracto
```

Verify readiness and that the tile service reports the expected mode and ID:

```sh
PUBLIC_ORIGIN=https://fracto.mikehallstudio.com:3000
curl --fail --silent --show-error "$PUBLIC_ORIGIN/api/main/readyz"
curl --fail --silent --show-error "$PUBLIC_ORIGIN/api/tiles/cache_status" |
  FRACTO_EXPECTED_GENERATION=production-tiles-v2 node -e \
  "let text='';process.stdin.on('data',chunk=>text+=chunk);process.stdin.on('end',()=>{const status=JSON.parse(text);if(status.source_mode!=='local'||status.source_generation!==process.env.FRACTO_EXPECTED_GENERATION)process.exit(1);console.log('local tile source generation verified')})"
```

Keep the prior source root and completed index generation for the rollback
window. If preflight, readiness, or tile status fails, stop `fracto`, restore
the old source path and ID in `.env`, select the recorded old index generation
with `scripts/select_tile_index_generation.js`, rerun startup preflight, and
start Compose with `up -d --wait --wait-timeout 300 fracto`. Verify the same
two endpoints again. Do not remove either source release or its index generation
until rollback is no longer required. Candidate index builds do not prune old
generations; schedule cleanup only after the retention decision is explicit.
Remove the temporary candidate env file after the release is accepted or
rolled back with `rm -f "$CANDIDATE_ENV"`.

Use the same pair of Compose files for maintenance commands that need the
local source configuration. To return to the normal remote-cache deployment,
recreate the service using only `compose.yaml`. Do not change nginx routing or
publish a new tile port for this mode.

## Verify

After deployment, check the public UI and APIs:

```sh
curl -I https://fracto.mikehallstudio.com:3000/
curl -i https://fracto.mikehallstudio.com:3000/api/admin/ports
curl -i https://fracto.mikehallstudio.com:3000/api/main/healthz
```

After the stack is healthy, run the integrated proxy probe from the EC2
checkout. It checks `/readyz` through nginx, confirms the public UI returns
HTML, compares each `/api/...` route with its corresponding loopback service,
and verifies Docker bound ports 3001-3006 only to `127.0.0.1`:

```sh
bash scripts/verify_ec2_proxy.sh https://fracto.mikehallstudio.com:3000
```

The ports endpoint is intentionally public and should return the runtime
service-port map. The main health endpoint should return its health contract.
Complete a Google sign-in and verify that the browser remains on the HTTPS
origin and returns through `/api/main/auth/callback`.

Keep direct backend ports private; production Compose binds them only to host
loopback. If nginx and Fracto run in separate containers instead of nginx on
the host, replace loopback upstream addresses with the Fracto container's
private network name and do not publish backend ports publicly.
