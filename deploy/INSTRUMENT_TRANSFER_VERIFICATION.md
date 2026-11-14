# Instrument transfer local verification — 2026-11-14

Step 6 passed locally. No production server was modified and no production export
was started. The operator performs final export and listening acceptance after
deployment using [the deployment guide](INSTRUMENT_TRANSFER.md).

## Full installed-library probe

`scripts/verify_instrument_transfer.js` used the development instrument directory
as a read-only export source and a uniquely owned temporary receiver, through
loopback admin/asset HTTP routers with ephemeral credentials. Results are saved
in `logs/instrument_transfer_verification.json`; the disposable receiver was
removed after successful completion.

| Check | Result |
| --- | --- |
| Empty receiver preview | 1,624 missing files; zero conflicts |
| Whole package transfer | 7,748,674,418 bytes transferred, published and verified |
| Public receiver inventory | All 149 melodic instruments available |
| Receiver service restart | Identical durable receipt recovered; Bach samples still available |
| Identical-library preview after restart | 1,624 matching files; zero missing bytes |
| Deliberately removed guitar dependency | Exactly one missing file; 3,360,170 bytes transferred for repair |
| Repaired library | New verified completion; Bach assignment and WAV checks passed again |
| Source catalog | Unchanged after the probe |

The source catalog SHA-256 is
`9be3f13291b3053efa71bd3d407eaed331098dc4054fae9bb9243da596a4d9f7`.
The verified manifest SHA-256 is
`ea2ae67bfde69e2b5af05904c3af4d0fa4d490120ec36b72f9e761ab2044db58`.

`Bach_Partita_No1_BWV825_Allemande.mid` contains 1,250 playable notes in track 2,
channel 1 (zero-based), using program 24 / GM program 25. The receiving client's
original assignment resolves to **Acoustic Guitar Nylon**. Four real sample
chunks passed HTTP status, content-hash, canonical PCM16 WAV and sample-window
checks, with non-silent PCM data. The file's separate Guitar Left setup track
contains no notes. These are parser/registry/data-path checks; audible output is
reserved for operator acceptance.

## Production candidate and regression checks

Local image: `fracto:instrument-transfer-candidate-20261114`.
Image ID:
`sha256:bd44d312a50c9b0d0d5eb823af27a8bd3838fc799ee585026e737c6cb5ba4c75`.

- The complete production Docker build passed root syntax, 17 migration-file
  checks, root regression tests (409 passed, 2 skipped), AI service checks, UI
  lint/build and production dependency pruning.
- All 49 transfer/authorization tests passed against the production candidate.
  They include reverse-direction publication, a completed zero-byte no-op,
  corrupt streams, conflicts, cancellation, lost acknowledgements, path/link
  rejection, disk limits and process crashes around publication. The final added
  regression test file was mounted read-only over its image copy; application
  code came from the image.
- Hashes of all 37 changed runtime JS/JSX/JSON files matched the candidate image.
- Candidate runs as UID 1000 and its default persistent instrument directory is
  writable. Two fresh candidate containers published and recovered an identical
  receipt on a labelled disposable volume, with verification running as UID 1000.
  The test volume was removed after checking its ownership label.
- Additional local checks passed: 38 asset catalog/index/audio/HTTP tests,
  135 MIDI/player tests, 13 instrument-control tests and related UI/catalog
  regressions. The Windows root run passed 403 tests with 7 optional tests skipped;
  sandboxed Windows AI-test cleanup required stopping only its isolated child tree.
- Production and development Compose configurations validated. Both nginx
  profiles passed `nginx -t` in network-isolated nginx 1.28 containers using an
  ephemeral test certificate. Their instrument routes stream uploads, preserve
  the transfer namespace and enforce a 512 MiB per-request ceiling.

Build output retained existing dependency audit findings, including critical
findings; this feature changes no locked dependency versions. UI lint retained
three existing test-global warnings, and Vite reported its existing bundle-size
warning. nginx 1.28 also warned about the existing `listen ... http2` syntax;
the examples retain it for compatibility with older installations. Review the
host's normal dependency/security and nginx-version policies during deployment.

## Deployment state

The active development container was left running. Its trusted-peer map is valid
and isolated-lab sync access is enabled, but it predates the new persistence
environment flag. Rebuild/recreate both ends through their normal workflows to
activate the updated configuration. Keep the same persistent mounts and Compose
project identity. The coordinated local release is
`milestone/instrument-transfer-v1` across the root and all six service repositories.
Remote publication remains pending. The original handoff ZIP is the pre-commit
source snapshot and records its baseline commits and file hashes; use the tagged
Git release for the committed source state.

The candidate image is local only. Production deployment, actual peer transfer,
container-recreation acceptance on that host and listening remain operator work.
