param(
    [ValidatePattern('^(Auto|\d+\.\d+\.\d+)$')]
    [string]$Version = 'Auto',

    [switch]$Prerelease,
    [switch]$Push,
    [switch]$Commit,
    [string]$RepoRoot
)

$ErrorActionPreference = 'Stop'

$repoRoot = if ($RepoRoot) {
    [IO.Path]::GetFullPath($RepoRoot)
}
else {
    Split-Path -Parent $PSScriptRoot
}
$repo = 'Thieez/obsidian-plugin-installer'
$manifestPath = Join-Path $repoRoot 'manifest.json'
$versionsPath = Join-Path $repoRoot 'versions.json'
$mainPath = Join-Path $repoRoot 'main.js'
$stylesPath = Join-Path $repoRoot 'styles.css'

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is not available in PATH."
    }
}

Require-Command 'git'
Require-Command 'npm'
Require-Command 'gh'

Push-Location $repoRoot
try {
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    $versions = Get-Content $versionsPath -Raw | ConvertFrom-Json

    if ($Version -ieq 'Auto') {
        $knownVersions = @([version]$manifest.version)
        foreach ($tagName in @(git tag --list)) {
            if ($tagName -match '^v?(\d+\.\d+\.\d+)$') {
                $knownVersions += [version]$Matches[1]
            }
        }
        $latestVersion = $knownVersions | Sort-Object -Descending | Select-Object -First 1
        $Version = "$($latestVersion.Major).$($latestVersion.Minor).$([int]$latestVersion.Build + 1)"
        Write-Host "Auto-selected release version $Version." -ForegroundColor Cyan
    }

    $tag = $Version
    $distPath = Join-Path $repoRoot 'dist'
    $archivePath = Join-Path $distPath "plugin-zip-installer-$Version.zip"
    $status = git status --porcelain
    if ($status) {
        if (-not $Commit) {
            throw 'Working tree is not clean. Commit or stash changes before publishing, or use -Commit.'
        }
        git add -A
        git commit -m "Prepare release $tag`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
        if ($LASTEXITCODE -ne 0) {
            throw 'Could not commit the release preparation changes.'
        }
    }

    $existingTag = git tag --list $tag
    $reuseExistingTag = [bool]$existingTag
    if ($reuseExistingTag -and $manifest.version -ne $Version) {
        throw "Git tag $tag exists, but manifest.json is not prepared for version $Version."
    }

    $versionChanged = $manifest.version -ne $Version
    $versionsChanged = $false
    if ($versionChanged) {
        $manifest.version = $Version
        $manifestJson = $manifest | ConvertTo-Json -Depth 10
        [IO.File]::WriteAllText($manifestPath, $manifestJson, [Text.UTF8Encoding]::new($false))
        $versions | Add-Member -NotePropertyName $Version -NotePropertyValue $manifest.minAppVersion -Force
        $versionsJson = $versions | ConvertTo-Json -Depth 10
        [IO.File]::WriteAllText($versionsPath, $versionsJson, [Text.UTF8Encoding]::new($false))
        $versionsChanged = $true
    }
    elseif ($Version -notin $versions.PSObject.Properties.Name) {
        $versions | Add-Member -NotePropertyName $Version -NotePropertyValue $manifest.minAppVersion -Force
        $versionsJson = $versions | ConvertTo-Json -Depth 10
        [IO.File]::WriteAllText($versionsPath, $versionsJson, [Text.UTF8Encoding]::new($false))
        $versionsChanged = $true
    }

    npm ci
    if ($LASTEXITCODE -ne 0) {
        throw 'npm ci failed.'
    }
    npm test
    if ($LASTEXITCODE -ne 0) {
        throw 'Plugin build or tests failed.'
    }

    foreach ($releaseFile in @($mainPath, $stylesPath)) {
        if (-not (Test-Path -LiteralPath $releaseFile -PathType Leaf)) {
            throw "Plugin release file was not created: $releaseFile"
        }
    }
    New-Item -ItemType Directory -Path $distPath -Force | Out-Null
    if (Test-Path -LiteralPath $archivePath) {
        Remove-Item -LiteralPath $archivePath -Force
    }
    Compress-Archive -LiteralPath $mainPath, $manifestPath, $stylesPath -DestinationPath $archivePath

    if ($versionChanged -or $versionsChanged) {
        git add manifest.json versions.json main.js
        git commit -m "Release $tag`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
        if ($LASTEXITCODE -ne 0) {
            throw "Could not commit version metadata for $tag."
        }
    }

    if (-not $reuseExistingTag) {
        git tag -a $tag -m "Release $tag"
        if ($LASTEXITCODE -ne 0) {
            throw "Could not create release tag $tag."
        }
        if ($Push) {
            git push origin main
            if ($LASTEXITCODE -ne 0) { throw 'Could not push main.' }
            git push origin $tag
            if ($LASTEXITCODE -ne 0) { throw "Could not push tag $tag." }
        }
    }
    elseif ($Push) {
        git push origin $tag
        if ($LASTEXITCODE -ne 0) { throw "Could not push tag $tag." }
    }

    $releaseAssets = @($mainPath, $manifestPath, $stylesPath, $versionsPath, $archivePath)
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & gh release view $tag --repo $repo --json tagName 2>$null | Out-Null
        $releaseExists = $LASTEXITCODE -eq 0
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    if ($releaseExists) {
        & gh release upload $tag $releaseAssets --repo $repo --clobber
    }
    else {
        $releaseArgs = @('release', 'create', $tag, '--repo', $repo, '--title', $tag, '--generate-notes')
        if ($Prerelease) {
            $releaseArgs += '--prerelease'
        }
        & gh @releaseArgs
        if ($LASTEXITCODE -ne 0) {
            throw "GitHub Release creation failed for $tag."
        }
        & gh release upload $tag $releaseAssets --repo $repo --clobber
    }
    if ($LASTEXITCODE -ne 0) {
        throw "GitHub Release asset upload failed for $tag."
    }

    Write-Host "Published $tag with asset $([IO.Path]::GetFileName($archivePath))." -ForegroundColor Green
}
finally {
    Pop-Location
}
