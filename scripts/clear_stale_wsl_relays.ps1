param(
    [ValidateSet('prod', 'dev')][string]$Mode = 'prod',
    [ValidateRange(0, 600)][int]$WaitSeconds = 300,
    [ValidateRange(100, 10000)][int]$ProbeTimeoutMs = 1500
)

# This host bootstrap uses no npm packages and never stops Docker or WSL itself.
function Get-FractoListeners {
    @(Get-NetTCPConnection -State Listen -ErrorAction Stop)
}

function Get-FractoProcess([int]$ProcessId) {
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
    [pscustomobject]@{
        Id = $process.Id
        Name = $process.ProcessName
        Path = $process.Path
        Started = $process.StartTime.ToUniversalTime().Ticks
    }
}

function Test-FractoHttp([int]$Port, [bool]$Ipv6, [int]$TimeoutMs, [switch]$Localhost) {
    Add-Type -AssemblyName System.Net.Http
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.UseProxy = $false
    $handler.AllowAutoRedirect = $false
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromMilliseconds($TimeoutMs)
    $address = if ($Localhost) { 'localhost' } elseif ($Ipv6) { '[::1]' } else { '127.0.0.1' }
    try {
        $response = $client.GetAsync("http://${address}:$Port/healthz", [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        $response.Dispose()
        return $true # Any HTTP response proves transport works, including 503.
    } catch {
        return $false
    } finally {
        $client.Dispose()
        $handler.Dispose()
    }
}

function Test-FractoRelayIdentity($Process) {
    $trusted = @(
        (Join-Path $env:ProgramFiles 'WSL\wslrelay.exe'),
        (Join-Path $env:SystemRoot 'System32\wslrelay.exe')
    )
    $Process.Name -eq 'wslrelay' -and $Process.Path -in $trusted -and $Process.Started
}

function Test-FractoRelayScope($Listeners, [int]$ProcessId) {
    $owned = @($Listeners | Where-Object { $_.OwningProcess -eq $ProcessId })
    $other = @($owned | Where-Object {
        $_.LocalAddress -notin @('::1', '127.0.0.1') -or
        -not (($_.LocalPort -ge 3001 -and $_.LocalPort -le 3007) -or
              ($_.LocalPort -ge 3101 -and $_.LocalPort -le 3107))
    })
    $owned.Count -gt 0 -and $other.Count -eq 0
}

function Test-FractoDockerListener($Listeners, [int]$Port) {
    foreach ($listener in @($Listeners | Where-Object {
        $_.LocalPort -eq $Port -and $_.LocalAddress -in @('::', '0.0.0.0', '127.0.0.1')
    })) {
        try {
            $owner = Get-FractoProcess $listener.OwningProcess
            if ($owner.Name -eq 'com.docker.backend' -and [IO.Path]::GetFileName($owner.Path) -eq 'com.docker.backend.exe') { return $true }
        } catch { }
    }
    return $false
}

function Stop-FractoRelay($Expected) {
    # Reopen and verify the process immediately before stopping it; PID reuse is unsafe.
    $current = Get-FractoProcess $Expected.Id
    if (-not (Test-FractoRelayIdentity $current) -or $current.Started -ne $Expected.Started -or $current.Path -ne $Expected.Path) {
        throw 'WSL relay identity changed; refusing to stop the process.'
    }
    $process = Get-Process -Id $current.Id -ErrorAction Stop
    $null = $process.Handle
    if ($process.ProcessName -ne $current.Name -or $process.Path -ne $current.Path -or $process.StartTime.ToUniversalTime().Ticks -ne $current.Started) {
        throw 'WSL relay identity changed before stop; left untouched.'
    }
    Stop-Process -InputObject $process -Force -ErrorAction Stop
}

function Invoke-FractoRelayRepair([string]$Mode, [int]$WaitSeconds, [int]$ProbeTimeoutMs) {
    $basePort = if ($Mode -eq 'dev') { 3101 } else { 3001 }
    $deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
    $announced = $false
    $cleared = 0
    $verifyPorts = @()
    do {
        $waiting = $false
        foreach ($verifyPort in $verifyPorts) {
            if (-not (Test-FractoHttp $verifyPort $false $ProbeTimeoutMs) -or -not (Test-FractoHttp $verifyPort $false $ProbeTimeoutMs -Localhost)) {
                $waiting = $true
            }
        }
        $listeners = @(Get-FractoListeners)
        $candidates = @($listeners | Where-Object {
            $_.LocalAddress -eq '::1' -and $_.LocalPort -ge $basePort -and $_.LocalPort -le ($basePort + 6)
        } | Select-Object -ExpandProperty OwningProcess -Unique)
        foreach ($processId in $candidates) {
            try { $relay = Get-FractoProcess $processId } catch { continue }
            if ($relay.Name -ne 'wslrelay') { continue }
            # Prefer the UI; it may become ready after the compiled tile index loads.
            $ports = @($listeners | Where-Object {
                $_.OwningProcess -eq $processId -and $_.LocalPort -ge $basePort -and $_.LocalPort -le ($basePort + 6)
            } | Select-Object -ExpandProperty LocalPort -Unique | Sort-Object -Descending)
            foreach ($port in $ports) {
                if (-not (Test-FractoDockerListener $listeners $port)) { continue }
                if (-not (Test-FractoHttp $port $false $ProbeTimeoutMs)) {
                    $waiting = $true
                    continue
                }
                if (Test-FractoHttp $port $true $ProbeTimeoutMs) { continue }
                # Require a second healthy IPv4 / failed IPv6 observation.
                if (-not (Test-FractoHttp $port $false $ProbeTimeoutMs) -or (Test-FractoHttp $port $true $ProbeTimeoutMs)) {
                    $waiting = $true
                    continue
                }
                if (-not (Test-FractoRelayIdentity $relay) -or -not (Test-FractoRelayScope $listeners $processId)) {
                    throw "WSL relay $processId also serves non-Fracto addresses/ports or has an untrusted identity; left untouched."
                }
                $fresh = @(Get-FractoListeners)
                if (-not (Test-FractoRelayScope $fresh $processId) -or -not @($fresh | Where-Object {
                    $_.OwningProcess -eq $processId -and $_.LocalAddress -eq '::1' -and $_.LocalPort -eq $port
                }).Count) {
                    throw 'WSL relay listeners changed during inspection; left untouched.'
                }
                if (-not (Test-FractoDockerListener $fresh $port)) {
                    throw 'Docker listener changed during inspection; left the WSL relay untouched.'
                }
                $current = Get-FractoProcess $processId
                if (-not (Test-FractoRelayIdentity $current) -or $current.Started -ne $relay.Started -or $current.Path -ne $relay.Path) {
                    throw 'WSL relay identity changed during inspection; left untouched.'
                }
                Stop-FractoRelay $relay
                $cleared++
                Write-Host "Cleared stale WSL relay $processId on Fracto port $port; Docker IPv4 responded while IPv6 stalled."
                $verifyPorts += $port
                $waiting = $waiting -or (-not (Test-FractoHttp $port $false $ProbeTimeoutMs -Localhost))
                break
            }
        }
        if (-not $waiting) {
            Write-Host "Fracto localhost relay check complete ($cleared stale relays cleared)."
            return
        }
        if (-not $announced) {
            Write-Host 'Waiting for the Fracto Docker HTTP listeners to verify localhost routing...'
            $announced = $true
        }
        if ([DateTime]::UtcNow -ge $deadline) { break }
        Start-Sleep -Seconds 1
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Could not verify Fracto localhost routing before the timeout. Containers were left running; inspect their logs and rerun this check.'
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        Invoke-FractoRelayRepair $Mode $WaitSeconds $ProbeTimeoutMs
        exit 0
    } catch {
        Write-Error $_.Exception.Message
        exit 1
    }
}
