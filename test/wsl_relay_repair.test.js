import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = fileURLToPath(
  new URL("../scripts/clear_stale_wsl_relays.ps1", import.meta.url),
);

function simulate(t, scenario) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "fracto-relay-test-"),
  );
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("fracto-relay-test-"));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const harness = path.join(directory, "fixture.ps1");
  fs.writeFileSync(
    harness,
    `
. '${script.replaceAll("'", "''")}'
$script:scenario = '${scenario}'
$script:stops = @()
$script:listenerReads = 0
$script:probes = 0
$script:stopped = $false
$script:testPort = if ($script:scenario -eq 'prod') { 3006 } else { 3106 }
function Get-FractoListeners {
  $script:listenerReads++
  if ($script:scenario -eq 'none') { return @() }
  $docker = [pscustomobject]@{LocalAddress='::';LocalPort=$script:testPort;OwningProcess=5100}
  if ($script:stopped) { return @($docker) }
  $all = @($docker, [pscustomobject]@{LocalAddress='::1';LocalPort=$script:testPort;OwningProcess=4200})
  if ($script:scenario -eq 'shared' -or ($script:scenario -eq 'scope_changed' -and $script:listenerReads -gt 1)) {
    $all += [pscustomobject]@{LocalAddress='::1';LocalPort=8080;OwningProcess=4200}
  }
  return $all
}
function Get-FractoProcess([int]$ProcessId) {
  if ($ProcessId -eq 5100) {
    $name = if (($script:scenario -eq 'not_docker' -or ($script:scenario -eq 'docker_changed' -and $script:listenerReads -gt 1))) { 'other' } else { 'com.docker.backend' }
    return [pscustomobject]@{Id=5100;Name=$name;Path='C:\\Docker\\com.docker.backend.exe';Started=1}
  }
  $name = if ($script:scenario -eq 'not_relay') { 'node' } else { 'wslrelay' }
  $exe = if ($script:scenario -eq 'untrusted') { 'C:\\temp\\wslrelay.exe' } else { Join-Path $env:ProgramFiles 'WSL\\wslrelay.exe' }
  $started = if ($script:scenario -eq 'pid_changed' -and $script:listenerReads -gt 1) { 2 } else { 1 }
  [pscustomobject]@{Id=4200;Name=$name;Path=$exe;Started=$started}
}
function Test-FractoHttp([int]$Port, [bool]$Ipv6, [int]$TimeoutMs, [switch]$Localhost) {
  $script:probes++
  if ($script:scenario -eq 'ipv4_down') { return $false }
  if ($script:scenario -eq 'healthy') { return $true }
  if (-not $Ipv6 -and -not $Localhost) { return $true }
  return $script:stopped -and $script:scenario -ne 'still_broken'
}
function Stop-FractoRelay($Expected) {
  $script:stops += $Expected.Id
  $script:stopped = $true
}
$failure = $null
try { Invoke-FractoRelayRepair -Mode $(if ($script:scenario -eq 'prod') { 'prod' } else { 'dev' }) -WaitSeconds 0 -ProbeTimeoutMs 100 }
catch { $failure = $_.Exception.Message }
Write-Output ('RESULT ' + (@{stops=@($script:stops);error=$failure;probes=$script:probes} | ConvertTo-Json -Compress))
`,
  );
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", harness],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 20000,
    },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const line = result.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith("RESULT "));
  assert.ok(line, result.stdout + result.stderr);
  return JSON.parse(line.slice(7));
}

for (const scenario of ["stale", "prod"]) {
  test(
    `clears a proven stale Fracto-only relay in ${scenario} mode and verifies recovery`,
    { skip: process.platform !== "win32" },
    (t) => {
      const result = simulate(t, scenario);
      assert.deepEqual(result.stops, [4200]);
      assert.equal(result.error, null);
      assert.ok(result.probes >= 5);
    },
  );
}

for (const scenario of ["none", "healthy", "not_relay", "not_docker"]) {
  test(
    `leaves ${scenario} listeners untouched`,
    { skip: process.platform !== "win32" },
    (t) => {
      const result = simulate(t, scenario);
      assert.deepEqual(result.stops, []);
      assert.equal(result.error, null);
    },
  );
}

for (const [scenario, message] of [
  ["shared", /non-Fracto/],
  ["untrusted", /untrusted/],
  ["scope_changed", /listeners changed/],
  ["pid_changed", /identity changed/],
  ["docker_changed", /Docker listener changed/],
  ["ipv4_down", /timeout/],
]) {
  test(
    `refuses unsafe or unproven repair: ${scenario}`,
    { skip: process.platform !== "win32" },
    (t) => {
      const result = simulate(t, scenario);
      assert.deepEqual(result.stops, []);
      assert.match(result.error, message);
    },
  );
}

test(
  "a relay removal is not reported as success if localhost stays broken",
  { skip: process.platform !== "win32" },
  (t) => {
    const result = simulate(t, "still_broken");
    assert.deepEqual(result.stops, [4200]);
    assert.match(result.error, /Could not verify/);
  },
);

test("cold boot checks routing after normal/dev and managed production startup", () => {
  const source = fs.readFileSync(
    new URL("../scripts/cold_boot.bat", import.meta.url),
    "utf8",
  );
  const calls = [
    ...source.matchAll(
      /powershell\.exe[^\r\n]*clear_stale_wsl_relays\.ps1[^\r\n]*/g,
    ),
  ];
  assert.equal(calls.length, 2);
  assert.ok(calls.every(([line]) => line.includes("-Mode %cold_boot_mode%")));
  assert.match(
    source,
    /:stream_logs\r?\n[\s\S]*clear_stale_wsl_relays\.ps1[\s\S]*Cold boot complete/,
  );
  assert.match(
    source,
    /managed_production\.js upgrade[\s\S]*clear_stale_wsl_relays\.ps1[\s\S]*Managed production is running/,
  );
});
