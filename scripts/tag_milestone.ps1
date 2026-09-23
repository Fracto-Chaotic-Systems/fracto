param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^milestone/[a-z0-9-]+-v[0-9]+$')]
    [string]$Name,

    [Parameter(Mandatory = $true)]
    [string]$Message
)

$repositories = @(
    ".",
    "servers/fracto-ui",
    "servers/fracto-data-server",
    "servers/fracto-asset-server",
    "servers/fracto-tiles-server",
    "servers/fracto-admin-server"
)

$resolved = @()
foreach ($repository in $repositories) {
    $path = (Resolve-Path $repository).Path
    $status = @(git -C $path status --porcelain)
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to inspect repository: $repository"
    }
    if ($status.Count -gt 0) {
        throw "Repository is not clean: $repository"
    }
    $existing = @(git -C $path tag --list $Name)
    if ($existing.Count -gt 0) {
        throw "Tag already exists in repository: $repository"
    }
    $resolved += $path
}

foreach ($path in $resolved) {
    git -C $path tag --annotate $Name --message $Message
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to create tag in repository: $path"
    }
    Write-Output "Tagged $path with $Name"
}
