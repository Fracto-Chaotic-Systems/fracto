# Managed upgrade plan recovery

`upgrade-plan.mjs` reconstructs the missing module used by the installed lab
controller. Install it as `.fracto-managed/upgrade-plan.mjs`, beside that lab's
existing `docker-cutover-core.mjs`. Do not run the template directly from this
directory: its sibling import intentionally targets the installed helper.

The implementation reuses the supplied helper's `planContainer` and
`planAIOnlyPreflight` exports. It verifies the existing named AI store,
preserves production mount identities and options, adds named correction and
instrument stores when needed, and isolates writable rehearsal stores.
Image defaults advance while explicit container and deployment environment
values are retained. Unsupported storage identities or paths fail during
payload construction.

This is a reconstructed implementation, not a recovered copy of the original.
The fixture `test/fixtures/managed-production/docker-cutover-core.mjs` is the
exact helper supplied with the lab controller on 2026-11-26. Tests exercise
production payloads, AI-only rehearsal, Compose snapshot generation, and
successful promotion and rollback through a simulated Docker API:

```powershell
npm run test:managed-upgrade-plan
```

Importing the reconstructed module and helper performs no Docker operations.
Do not import `manage-production.mjs` just to validate imports: that controller
executes its selected action at module evaluation time.

To install a downloaded replacement on the lab, save `upgrade-plan.mjs` in
the current Windows user's Downloads directory, then run:

```powershell
Set-Location E:\mediaplex\fracto
$ErrorActionPreference = 'Stop'
$replacement = Join-Path $env:USERPROFILE 'Downloads\upgrade-plan.mjs'
Copy-Item -LiteralPath $replacement -Destination .fracto-managed\upgrade-plan.rebuilt.mjs
node --check .fracto-managed\upgrade-plan.rebuilt.mjs
if ($LASTEXITCODE -ne 0) { throw 'Replacement syntax check failed' }
node --input-type=module -e "const m=await import('./.fracto-managed/upgrade-plan.rebuilt.mjs'); if(typeof m.upgradePayload!=='function') throw Error('Missing upgradePayload'); console.log('Upgrade module imports successfully')"
if ($LASTEXITCODE -ne 0) { throw 'Replacement import check failed' }
$backup = '.fracto-managed\upgrade-plan.mjs.before-rebuild-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
Copy-Item -LiteralPath .fracto-managed\upgrade-plan.mjs -Destination $backup
Move-Item -LiteralPath .fracto-managed\upgrade-plan.rebuilt.mjs -Destination .fracto-managed\upgrade-plan.mjs -Force
node scripts\managed_production.js status
if ($LASTEXITCODE -ne 0) { throw 'Managed controller status failed; inspect the error before cold boot' }
```

After status succeeds, rerun `scripts\cold_boot.bat prod`. The offline tests do
not replace the controller's live readiness, inference, and rollback checks.
