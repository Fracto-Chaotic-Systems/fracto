param(
    [ValidateRange(1, 65535)][int]$Port = 3001,
    [switch]$Worker
)

$ErrorActionPreference = 'Stop'
try {
    if (-not $Worker) {
        $arguments = @('-NoProfile', '-File', ('"' + $PSCommandPath + '"'), '-Port', [string]$Port, '-Worker')
        $null = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden
        exit 0
    }
    # The kernel releases this lock on exit, including abnormal termination.
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $key = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes("$PSScriptRoot|$Port"))).Replace('-', '') }
    finally { $hash.Dispose() }
    $mutex = [Threading.Mutex]::new($false, "Local\FractoStartupBenchmark-$key")
    $locked = $false
    try {
        try { $locked = $mutex.WaitOne(0) }
        catch [Threading.AbandonedMutexException] { $locked = $true }
        if (-not $locked) { exit 0 }
        $observer = Join-Path $PSScriptRoot '../servers/fracto-ai-server/startup_benchmark.js'
        & node.exe $observer --port $Port
    } finally {
        if ($locked) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
} catch {
    Write-Warning 'Windows startup benchmark observer unavailable; Fracto startup continues.'
    exit 1
}
