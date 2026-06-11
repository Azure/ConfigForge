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
         "Release 'vX.Y.Z-author.N' does not exist".
      2. Dispatch release-mac.yml with the tag as input — it builds the
         .dmg on macos-latest and uploads to the draft release.

    Doing both manually every release is error-prone (this script exists
    because we forgot step 1 on v0.3.21-author.1 and had to retry).

.PARAMETER Tag
    The release tag, e.g. "v0.3.21-author.1". Must already exist as a
    git tag on the mac-author-build branch and be pushed to origin.

.PARAMETER ReleaseTitle
    Optional title for the GitHub release. Defaults to the tag.

.PARAMETER Notes
    Optional release notes. Defaults to a stub describing the mac flavor.

.EXAMPLE
    .\scripts\ship-mac.ps1 -Tag v0.3.21-author.1

.EXAMPLE
    .\scripts\ship-mac.ps1 -Tag v0.3.22-author.1 -Notes "Mac build of v0.3.21 with X fix"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidatePattern('^v\d+\.\d+\.\d+-author\.\d+$')]
    [string]$Tag,

    [string]$ReleaseTitle = "",

    [string]$Notes = "",

    [string]$Repo = "ABMFST/ConfigForge"
)

$ErrorActionPreference = 'Stop'

if (-not $ReleaseTitle) { $ReleaseTitle = "$Tag (mac author)" }
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

# Step 2: create the draft release (idempotent — skip if exists)
Write-Host "[2/3] Creating draft release..." -ForegroundColor Yellow
$existing = gh release view $Tag --repo $Repo 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "      Draft release already exists, skipping." -ForegroundColor Green
} else {
    gh release create $Tag `
        --repo $Repo `
        --target mac-author-build `
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
    --ref mac-author-build `
    -f release_tag=$Tag
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to dispatch workflow." -ForegroundColor Red
    exit 1
}
Write-Host "      Workflow dispatched." -ForegroundColor Green

Write-Host ""
Write-Host "===> Done. Build takes ~3-5 min on macos-latest." -ForegroundColor Cyan
Write-Host "     Watch: gh run watch --repo $Repo" -ForegroundColor DarkGray
Write-Host "     Or:   https://github.com/$Repo/actions/workflows/release-mac.yml" -ForegroundColor DarkGray
