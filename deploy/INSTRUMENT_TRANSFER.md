# Instrument transfer deployment and acceptance

Deploy the same compatible release to the sending and receiving hosts. Export
remains an explicit action after deployment; installing code does not start it.
The final production export and listening test belong to the operator.
Local results are recorded in [INSTRUMENT_TRANSFER_VERIFICATION.md](INSTRUMENT_TRANSFER_VERIFICATION.md).

## Release contents

Publish the coordinated root and service revisions. Five repositories contain
feature or build-test changes:

The coordinated local milestone is `milestone/instrument-transfer-v5`, annotated
in the root and every service repository, including unchanged services. Publish
the required branches and explicitly push this tag in all seven repositories
when releasing remotely.

| Repository | Required change |
| --- | --- |
| `fracto` | Shared transfer contract/streams, Docker/Compose persistent instrument storage, proxy configuration, verification tooling and private scratch-file exclusions |
| `servers/fracto-admin-server` | Authenticated inventory, jobs, source-replacement negotiation, streaming sender/receiver and publication receipt checks |
| `servers/fracto-asset-server` | Package inventory, verified staging/repair, backed-up file/catalog replacement, durable publication/recovery and persistent storage |
| `servers/fracto-ui` | Servers-page replacement preview, explicit source-authoritative export, progress, receipts and checksummed LAN HTTP playback |
| `servers/fracto-ai-server` | Bounded build-test concurrency and explicit real-adapter completion assertions |

Publish the four changed service repositories before the root integration release.
Record the coordinated commit IDs and the previous image ID. Source changes must
be committed, pushed and present on the deployed tracking branches before the
normal repository updater can use them. The local working copies are not a
published release. Do not include ignored audio, journals, `.env`, tokens or
database configuration in source commits. The transfer carries audio separately.
No database migration is introduced by this feature.

The original source ZIP in `logs/instrument-transfer-source-20261114.zip` captures
the pre-commit v1 feature files from root, Admin, Asset and UI, baseline commit IDs,
per-file hashes and verification evidence. It excludes audio, credentials and the
subsequent corrections. Use the v5 tagged Git revisions for current
deployment. The ZIP remains a historical review snapshot, not a complete checkout
or an automatic installer.

## Configuration on both hosts

Keep each host's existing authentication, tile-source overlays and service-port
configuration. In its protected environment, configure `FRACTO_DATABASE_SYNC_PEERS`
as a JSON map keyed by the exact public URL saved in Admin / Servers:

```json
{
  "https://other-server.example:3000": {
    "endpoint": "https://other-server.example:3000/api/admin",
    "token": "<same private pair-specific secret on both hosts, at least 32 characters>"
  }
}
```

The other host uses the reciprocal public URL as its key and this host's admin
endpoint. Direct private-network admin URLs can be endpoints when intentionally
reachable. Use HTTPS for public endpoints. Never put pair tokens in browser
settings or commands saved in shell history. Keep `FRACTO_INTERNAL_SERVICE_TOKEN`
set locally for each host's admin-to-asset calls; it is distinct from the pair
token. Recreate containers after changing environment values.

Use an administrator session and the exact `FRACTO_UI_ORIGIN`. For the existing
isolated, auth-disabled Windows lab only, `FRACTO_ADMIN_SYNC_LAB_BYPASS=true` also
requires `FRACTO_AUTH_MODE=none`, authentication not required, and that exact
Origin. Read-only bypass alone cannot export. Preserve authenticated settings on
public installations. See [the Windows lab guide](WINDOWS_LAB.md).

Production Compose mounts the named `fracto-instruments` volume at
`/var/lib/fracto/instruments`, with `FRACTO_INSTRUMENT_TRANSFER_PERSISTENT=true`.
Keep the existing Compose project name so container recreation reuses the same
volume. A custom instrument directory needs its own persistent mount. Native
installs need a durable writable instrument directory and the same flag. The
flag alone does not create storage. The development container retains its bound
instrument directory. Do not mount development and production into one library.

Back up the destination library/volume before the first export, including its
catalog, originals, indexes, playback, notices and `.instrument-transfer` state.
Inspect its actual mount through the container's Mounts metadata; do not guess
a volume name from this guide. The preview reports required/free space. It must
cover missing bytes, candidate/installed data and the safety margin. Keep offline
instrument importers idle while transferring. Neither image rebuild nor restart
may replace an existing catalog. Different catalogs intentionally block v1 export.

## Rebuild and recreate

Use the host's normal deployment workflow with **all existing Compose overlays**.
After updating the four repositories, the base production equivalent is:

```sh
docker compose -f compose.yaml config --quiet
docker compose -f compose.yaml build fracto
docker compose -f compose.yaml up -d --no-build --force-recreate --wait --wait-timeout 300 fracto
```

For development use `compose.yaml` plus `compose.dev.yaml`, service `fracto-dev`.
For a host managed by an installed production launcher/controller or the EC2
deployment workflow, use that workflow so it preserves managed-image identity,
overlays and rollback images. Do not start a second unmanaged production stack.
Keep other services and volumes; do not use `down --volumes` or volume renewal.

Install the narrow streaming location from the appropriate
[`nginx` example](nginx/README.md) when using `/api/admin` endpoints. Preserve the
host's existing TLS, headers and other routes. Run `nginx -t`, then reload through
the host's normal nginx workflow. Peer routes retain token authentication;
internal asset routes remain private. Confirm health/readiness and inspect logs
for instrument-storage errors before exporting.

## Operator acceptance after deployment

V4 removes the playback dependency on Web Crypto availability. Install the UI's
locked dependencies (`@noble/hashes` 2.4.0) and rebuild its production bundle;
the ordinary Docker build performs both steps. After deploying, reload the browser
to load the updated JavaScript. LAN HTTP playback still checks encoded size and
SHA-256 before decoding; HTTPS/localhost retains the native digest path. No browser
security flags, checksum bypass or authentication/CORS changes are required.

1. Open Servers on the host with the complete library. Select the receiving
   connection. Confirm **From this server** and **To selected server**.
2. Preview. Confirm publication support on both hosts, expected matching/missing
   and replacement counts, and enough destination space. Updated receivers
   negotiate source replacement; reviewed differences do not block export.
   Preview is read-only.
   Upgrade errors require deploying both ends. Conflicts require comparing the
   catalogs/data; v1 has no force-overwrite action.
3. Select **Export instruments to this server** once. Monitor progress through
   publishing/verification. Leaving the page keeps server work running. On a lost
   response, return to status rather than starting another export. A partial or
   missing job requires a fresh preview; verified files are reused.
4. Require **Export complete** and inspect the verified receipt. Save its
   catalog/manifest hashes, file/byte counts and timestamp. Transferred bytes alone
   do not prove success.
5. On the receiving host, open Games / All Music and the original
   `Bach_Partita_No1_BWV825_Allemande.mid`. Its playable guitar track should resolve
   original GM program 25 to **Acoustic Guitar Nylon**. This file also has an empty
   guitar setup track; it has no notes to play. Play and listen, then seek,
   stop and replay. Other audited/disabled instruments remain gated by design.
6. Recreate the receiving application container using the same image/project and
   mounts. Confirm the catalog and sample URLs remain available, playback still
   works, and a new preview reports no missing files. Source admin job IDs may be
   lost on restart; the receiver's durable receipt remains available for seven
   days. Use a fresh preview when the panel reports a missing job.
7. If reverse export is needed, open Servers on the other host and review a new
   preview. Direction is always from the host whose page is open.

## Recovery and rollback

### Lab-wide initialization and repair

Use one complete, verified source as the lab's canonical instrument library.
Deploy the coordinated release to that source and every destination (root,
Admin, Asset and UI are required for the replacement flow). Keep each server's
existing trusted peer credentials and persistent instrument volume. A saved
server address alone does not establish trust. Recreate services if changing
environment configuration; rebuild/reload the UI after deployment.

From the canonical source's Servers page, process destinations one at a time:

1. Select the destination and preview. Confirm the direction and the explicit
   **Export and make destination match source** action. If legacy catalog/file
   conflict messages remain, check deployed Admin/Asset revisions on both ends
   and that the browser loaded the new UI. Never normalize notices manually.
2. Review package count, differing live files, payload bytes and available space.
   The destination's entire catalog, including defaults and assignments, will
   match the source; this is not a merge. Pause offline importers and external
   writers while exporting. Existing unrelated files are retained.
3. Export. Required source files are validated, received into verified staging,
   checked as a complete candidate, then installed. Differing old files are
   backed up at `.instrument-transfer/backups/<session-id>/<relative-path>`.
   The catalog commits last and also has a checksum-keyed backup. Retain these
   backups through operator acceptance; do not prune active staging/journals.
4. Require **Export verified** and a matching durable manifest/catalog receipt.
   Record its hashes, verified file/byte totals and completion time in the
   operator's local lab rollout record. Run another preview: require zero
   missing files and zero differing live files, all package files matching and
   zero transfer bytes. A repeat explicit export must also finish with zero
   payload bytes and a verified receipt.
5. Verify the public instrument inventory, the Bach MIDI assignment and playback
   on the destination's normal LAN HTTP address. V4's checksum fallback remains
   included. After acceptance, continue with the next destination from the same
   canonical source. Do not reverse-export an old destination into the source.

Interrupted jobs may have installed some replacements. A fresh preview reuses
verified cached/installed bytes and completes convergence; completion is never
inferred merely from staged files or matching counters. A receipt lost in transit
is recovered from receiver status. Backups do not imply automatic rollback: a
manual rollback must restore the previous catalog together with every dependency
it references. The exporter makes the registered package equivalent, not every
unreferenced file in the storage directory. No lab export is run by deployment.

### Historical percussion README conflict (v3/v4)

The observed Windows development checkout mixed CRLF/LF in
`fluidr3-percussion/README.md`. V3 pins its Git checkout to LF. This changes no
document text, catalog bytes or audio. A persistent destination retains its old
support files across image rebuilds, so updating the image alone may leave this
existing conflict in place.

For this specific library revision, the canonical README is 7,619 bytes with
SHA-256 `dd07e46736e73cbcf204ab04e34841fde0b44b8e3416bc7367068a6557242f5e`.
For older releases only, the former manual repair procedure was:

1. Ensure no transfer/importer is active. Read only
   `<FRACTO_INSTRUMENT_DIR>/fluidr3-percussion/README.md`; reject symlinks.
2. Normalize CRLF to LF in memory and require the exact size/hash above. If it
   does not match, stop and review the document differences; do not overwrite it.
3. Preserve an immutable backup of the original bytes outside the public package,
   then atomically replace only this README with the verified LF bytes.
4. Run a new preview from development. Require zero conflicts before selecting
   Export. Do not remove the catalog/audio or disable the conflict checks.

The normalized development copy still encountered this single destination
conflict on 2026-11-15. Destination bytes were not readable through the transfer
API, and no production file was changed by this chat. This procedure is an
operator-reviewed one-file repair. V5 supersedes this procedure with negotiated,
backed-up source replacement; a CRLF-only difference no longer blocks initialization.

### General recovery

Cancel before publication when possible; cancellation waits through a short
non-cancellable commit/verification section. Do not delete staging while a job
is active. A fresh preview reuses verified cached or installed files. If publication
acknowledgement is lost, query status rather than restoring the catalog blindly.

For an application regression, stop transfer work and redeploy the recorded
previous application image through the same managed workflow, retaining the
instrument volume. Rolling back code does not undo installed files. To restore
library data, stop its asset owner and restore the complete consistent pre-export
backup, including journal state; do not mix a backed-up catalog with unrelated
audio or live journals. Retain destination-only and older versioned files.

## Repeatable local evidence

The explicit full-data probe uses only loopback services and a uniquely owned
temporary receiver. It does not contact configured remote peers:

```sh
node scripts/verify_instrument_transfer.js --source servers/fracto-asset-server/instruments --midi /absolute/path/to/Bach_Partita_No1_BWV825_Allemande.mid
```

It writes `logs/instrument_transfer_verification.json`, including preview totals,
verified receipts, restart recovery, same-catalog repair and original MIDI
assignment/WAV readback. It needs several GB of temporary storage and deletes its
own receiver on completion. This is data-path verification; native audio output
and the production listening test remain operator acceptance.
