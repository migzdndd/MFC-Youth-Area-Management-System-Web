param(
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $RepoRoot 'MFC-Youth-Area-Management-System-Web-Safe-Source.zip'
}

$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
$TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("mfc-web-source-" + [guid]::NewGuid().ToString('N'))

$ExcludedDirectoryNames = @(
    '.git',
    'node_modules',
    '.vercel',
    '.supabase',
    'dist',
    'build',
    'out',
    '.next'
)

function Test-IsSensitiveEnvironmentFile {
    param([string]$RelativePath)

    $name = [System.IO.Path]::GetFileName($RelativePath)
    if ($name -eq '.env.example') { return $false }
    if ($name -eq '.env') { return $true }
    if ($name.StartsWith('.env.')) { return $true }
    return $false
}

try {
    New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null

    $files = Get-ChildItem -LiteralPath $RepoRoot -Recurse -Force -File | Where-Object {
        $relative = $_.FullName.Substring($RepoRoot.Length).TrimStart('\\', '/')
        $segments = $relative -split '[\\/]'

        if ($segments | Where-Object { $ExcludedDirectoryNames -contains $_ }) { return $false }
        if (Test-IsSensitiveEnvironmentFile -RelativePath $relative) { return $false }
        if ($_.Extension -ieq '.zip') { return $false }
        if ($_.Name -match '\.(log|tmp|temp|bak|swp)$') { return $false }
        return $true
    }

    foreach ($file in $files) {
        $relative = $file.FullName.Substring($RepoRoot.Length).TrimStart('\\', '/')
        $destination = Join-Path $TempRoot $relative
        $destinationDirectory = Split-Path -Parent $destination
        New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
        Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
    }

    $unsafe = Get-ChildItem -LiteralPath $TempRoot -Recurse -Force -File | Where-Object {
        $relative = $_.FullName.Substring($TempRoot.Length).TrimStart('\\', '/')
        Test-IsSensitiveEnvironmentFile -RelativePath $relative
    }

    if ($unsafe) {
        $paths = ($unsafe | ForEach-Object { $_.FullName }) -join "`n"
        throw "Packaging aborted: sensitive environment files were staged:`n$paths"
    }

    if (Test-Path -LiteralPath $OutputPath) {
        Remove-Item -LiteralPath $OutputPath -Force
    }

    Compress-Archive -Path (Join-Path $TempRoot '*') -DestinationPath $OutputPath -CompressionLevel Optimal

    Write-Host "Safe source package created:" -ForegroundColor Green
    Write-Host $OutputPath
    Write-Host "Excluded: .env/.env.*, .git, node_modules, .vercel, local build output, logs, and existing ZIPs."
    Write-Host "Kept: .env.example files."
}
finally {
    if (Test-Path -LiteralPath $TempRoot) {
        Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
