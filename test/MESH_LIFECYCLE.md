# Mesh lifecycle verification

The integration fixtures use real compressed mesh files, durable inventory
updates and HTTP handlers. Every test runs in a disposable, path-checked
temporary directory; existing tile and mesh volumes are not modified by fault
injection. Both `level` and `shortcode` storage layouts are exercised.

| Scenario | Required result |
| --- | --- |
| Empty inventory | Empty heat map and zero mesh coverage |
| Construct and publish | Ready entry appears in the unchanged viewport |
| Reuse a mesh | No source reread or spurious revision change |
| Mirrored view | Same canonical mesh count, reflected coverage |
| Ordinary heat-map request | No filesystem read or directory scan |
| Corrupt file, then retrieve | HTTP 503, invalid entry, coverage disappears |
| Rebuild corrupt file | Ready coverage returns |
| Deleted file, then retrieve | HTTP 404, entry removed, coverage disappears |
| External file addition | Appears after explicit reconciliation |
| Reopen a valid inventory | Counts, revision and inventory generation survive |
| Source generation changes | Old mesh is stale, retrieval is 409, coverage excluded |
| Damaged snapshot rebuild | Correct files rediscovered; new inventory generation forces UI refresh even if revision repeats |
| Process killed before publication | Pending intent recovered without a phantom mesh |
| Process killed after publication | Published file rediscovered and pending intent cleared |

Supporting persistence tests cover journal replay, torn records, compaction
interruption, denied writes and append failures. UI tests cover stationary-view
polling, generation/source/revision changes, rapid navigation, cancellation,
timeouts/retry, level selection and unmount cleanup.

Run from the root:

```powershell
npm run test:terrain-cache
node --test test/sdk_package.test.js
npm run check:syntax
```

Run from `servers/fracto-ui/`:

```powershell
npm run test:mesh-heat-map
npm run test:terrain-cache
npm run build
```

`npm run test:mesh-lifecycle` runs only the cross-layer HTTP/process-crash tests.
No database, cloud access, running Docker service, or browser is required.
These tests verify process-crash recovery and simulated storage failures, not
physical power-loss behavior or concurrent writers on a shared mesh volume.

## Verification run: 2026-10-28

- 42 root mesh tests, 2 SDK boundary checks and 9 UI tests passed.
- Targeted UI lint, root syntax checks and the production UI build passed.
- Development restart migrated the legacy inventory to a persistent epoch while
  retaining 64 meshes at revision 64, with no pending publications.
- An aggregate SHA-256 of all 64 compressed mesh files was identical before
  and after restart. Fault injection did not touch this volume.
- Live inventory and heat-map responses agreed on epoch and revision; the test
  region reported 64 ready level-10 meshes and complete 64×64 pixel coverage.

The tests found and fixed a recovery refresh gap: rebuilding a damaged snapshot
could repeat the old source/revision pair. Persisted inventory epochs now make
that new revision history observable to the stationary-view client.
