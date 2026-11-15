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
`milestone/instrument-transfer-v1` across the root and all six service repositories,
with the build-test correction below recorded as `milestone/instrument-transfer-v2`.
Local commits/tags must be published separately. The original handoff ZIP is the pre-commit
source snapshot and records its baseline commits and file hashes; use the tagged
Git release for the committed source state.

The candidate image is local only. Production deployment, actual peer transfer,
container-recreation acceptance on that host and listening remain operator work.

## Build-test follow-up: milestone/instrument-transfer-v2

A subsequent builder reported `RESULT_NOT_READY` in the real-adapter inference
test. That test waited for the worker slot to become idle, which can also mean a
failed or undispatched job, then tried to read its result. The original failing
job state was not included in that log. The failure did not reproduce in isolation.

The AI test now awaits the dispatched task and asserts persisted completion before
reading its result, exposing the actual job state/error on failure. AI `test` and
`check` scripts limit execution to two test files at once, reducing competing
HTTP/mTLS, SQLite and cryptographic fixture work on small build hosts. Runtime
inference code, admission rules, transport deadlines and token/thread assertions
are unchanged.

Validation passed: 27 focused inference/adapter tests; syntax checks for 102 AI
JavaScript files; and the complete AI suite in a build-style container with Git,
one CPU, 2 GB memory, network isolation and a read-only source mount (191 passed,
9 platform-specific tests skipped). The reported case passed as test 95. The
existing production candidate image above records v1; rebuild with the v2 AI and
root revisions to consume this correction. The original v1 tag is preserved.

## Support-document checkout follow-up: milestone/instrument-transfer-v3

The actual production preview on 2026-11-15 reported identical catalog hashes,
166 matching files, 1,457 missing files and one conflicting support document:
`fluidr3-percussion/README.md`. Development's 7,734-byte copy mixed Windows CRLF
and LF. Its LF-normalized 7,619 bytes exactly match the Git blob, with SHA-256
`dd07e46736e73cbcf204ab04e34841fde0b44b8e3416bc7367068a6557242f5e`.

After operator approval, only this development README was normalized and its Git
checkout was pinned to LF. One new inventory-only preview still reports the same
single destination conflict; no files were uploaded or published. The new source
manifest is `720909bb0b394426c7011ee0287e51c5d26913ccc9f989c43f22af68428a23cc`.
The production copy needs a separately authorized filesystem check/repair using
the guarded one-file procedure in the deployment guide. Its bytes cannot be read
through the current transfer API, so a line-ending-only destination difference
has not been established.

The 13 inventory/checkout tests passed on Windows and Linux. The new regression
checks fresh Git checkout with automatic CRLF conversion enabled and disabled.
No checksum-equivalence exception, overwrite permission or catalog/audio change
was introduced. A discovered local peer-configuration scratch file is now excluded
from Git and Docker contexts; all eight build-context tests pass. Earlier
milestone tags remain immutable; v3 records the checkout and exclusion fixes.
