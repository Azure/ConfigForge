# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

<#
.SYNOPSIS
    Ship a mac-author-build flavor release.

.DESCRIPTION
    The mac-author flavor lives on the `mac-author-build` branch and uses
    a different electron-builder config (electron-builder.author.yml).
    Shipping a mac build requires two API calls:

      1. Create a draft GitHub release attached to the mac tag, OR the
         release-mac.yml workflow's upload step will fail with
         "Release 'mac-vX.Y.Z-author.N' does not exist".
      2. Dispatch the protected main version of release-mac.yml with the tag
         as input — it checks out that tag, builds the .dmg on macos-latest,
         and uploads to the draft release.

    Doing both manually every release is error-prone (this script exists
    because we forgot step 1 on an earlier author release and had to retry).

.PARAMETER Tag
    The release tag, e.g. "mac-v0.3.94-author.1". Must already exist as a
    git tag on the mac-author-build branch and be pushed to origin.

.PARAMETER ReleaseTitle
    Optional title for the GitHub release. Defaults to
    "ConfigForge Author vX.Y.Z-author.N (macOS)".

.PARAMETER Notes
    Optional release notes. Defaults to a stub describing the mac flavor.

.PARAMETER NotesFile
    Optional path to a release-notes file. Cannot be combined with -Notes.

.EXAMPLE
    .\scripts\ship-mac.ps1 -Tag mac-v0.3.94-author.1

.EXAMPLE
    .\scripts\ship-mac.ps1 -Tag mac-v0.3.94-author.1 -NotesFile .\apps\desktop\build\release-notes-author.md
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidatePattern('^mac-v\d+\.\d+\.\d+-author\.\d+$')]
    [string]$Tag,

    [string]$ReleaseTitle = "",

    [string]$Notes = "",

    [string]$NotesFile = "",

    [string]$Repo = "Azure/ConfigForge"
)

$ErrorActionPreference = 'Stop'

if ($Notes -and $NotesFile) {
    throw 'Use either -Notes or -NotesFile, not both.'
}
if ($NotesFile) {
    $Notes = Get-Content -LiteralPath $NotesFile -Raw
}
if (-not $ReleaseTitle) {
    $version = $Tag.Substring('mac-v'.Length)
    $ReleaseTitle = "ConfigForge Author v$version (macOS)"
}
if (-not $Notes) {
    $Notes = "Mac author build of the corresponding unified release. " +
             "Uses electron-builder.author.yml with the mac-only appId / productName."
}

Write-Host "===> ship-mac.ps1" -ForegroundColor Cyan
Write-Host "     Tag:   $Tag"
Write-Host "     Repo:  $Repo"
Write-Host "     Title: $ReleaseTitle"
Write-Host ""

# Step 1: verify the tag exists on remote
Write-Host "[1/3] Verifying tag exists on remote..." -ForegroundColor Yellow
$tagExists = gh api "repos/$Repo/git/refs/tags/$Tag" 2>&1 | Select-String '"ref"' | Measure-Object | Select-Object -ExpandProperty Count
if ($tagExists -eq 0) {
    Write-Host "ERROR: Tag '$Tag' not found on remote $Repo. Push the tag first:" -ForegroundColor Red
    Write-Host "  git push origin $Tag" -ForegroundColor Red
    exit 1
}
Write-Host "      OK, tag is on remote." -ForegroundColor Green

# Step 2: create the draft release (idempotent — verify if it exists)
Write-Host "[2/3] Creating draft release..." -ForegroundColor Yellow
$existingJson = gh release view $Tag --repo $Repo --json isDraft,url 2>$null
if ($LASTEXITCODE -eq 0) {
    $existing = $existingJson | ConvertFrom-Json
    if (-not $existing.isDraft) {
        Write-Host "ERROR: Release '$Tag' already exists and is published. Refusing to upload." -ForegroundColor Red
        exit 1
    }
    Write-Host "      Draft release already exists, skipping: $($existing.url)" -ForegroundColor Green
} else {
    gh release create $Tag `
        --repo $Repo `
        --verify-tag `
        --draft `
        --title $ReleaseTitle `
        --notes $Notes
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to create draft release." -ForegroundColor Red
        exit 1
    }
    Write-Host "      Draft release created." -ForegroundColor Green
}

# Step 3: dispatch the mac build workflow
Write-Host "[3/3] Dispatching release-mac.yml..." -ForegroundColor Yellow
gh workflow run "Release (macOS author)" `
    --repo $Repo `
    --ref main `
    -f release_tag=$Tag
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to dispatch workflow." -ForegroundColor Red
    exit 1
}
Write-Host "      Workflow dispatched." -ForegroundColor Green

Write-Host ""
Write-Host "===> Done. Build typically takes ~15-20 min on macos-latest." -ForegroundColor Cyan
Write-Host "     Watch: gh run watch --repo $Repo" -ForegroundColor DarkGray
Write-Host "     Or:   https://github.com/$Repo/actions/workflows/release-mac.yml" -ForegroundColor DarkGray
