# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

# ConfigForge — Phase 8 dev-cert generator
#
# ⚠️ DEV ONLY. Mints a SELF-SIGNED code-signing cert for local POC
# packaging. Windows will NOT trust the signature for end users; the
# resulting cert is only useful for verifying packaging works on your
# own machine. CI does NOT sign — official release artifacts are
# unsigned by design, and this script is a purely local, optional
# convenience (it never runs in CI).
#
# The default `-PfxPassword` value (`configforge-dev`) is a non-secret
# throwaway. Override it for your own dev cert if you want, but DO NOT
# reuse it as a production signing password.
#
# Usage (no admin needed — uses Cert:\CurrentUser\My):
#   .\apps\desktop\scripts\generate-dev-cert.ps1
#
# Outputs:
#   apps/desktop/build/dev-cert.pfx   (gitignored)
#   apps/desktop/build/dev-cert.cer   (gitignored — for inspection only)
#
# After running, set the env vars it prints to enable signing in
# `npm run dist:win`. Cert expires in 1 year; rerun this script to
# rotate.

param(
    [string]$Subject = "CN=ConfigForge Dev",
    [string]$PfxPassword = "configforge-dev",
    [int]$ValidityDays = 365
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "[dev-cert] ⚠️  DEV CERT ONLY — Windows will NOT trust this signature for end users." -ForegroundColor Yellow
Write-Host "[dev-cert]    Production releases sign via the WIN_CSC_LINK_BASE64 GitHub secret." -ForegroundColor Yellow
Write-Host ""

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BuildDir = Join-Path $ScriptDir ".." "build" | Resolve-Path -ErrorAction SilentlyContinue
if (-not $BuildDir) {
    $BuildDir = Join-Path $ScriptDir ".." "build"
    New-Item -ItemType Directory -Path $BuildDir -Force | Out-Null
    $BuildDir = Resolve-Path $BuildDir
}

$PfxPath = Join-Path $BuildDir "dev-cert.pfx"
$CerPath = Join-Path $BuildDir "dev-cert.cer"

Write-Host "[dev-cert] subject: $Subject"
Write-Host "[dev-cert] validity: $ValidityDays days"
Write-Host "[dev-cert] pfx out:  $PfxPath"

# New-SelfSignedCertificate requires the CodeSigningCert type
# (alias for: KeyUsage=DigitalSignature, EKU=1.3.6.1.5.5.7.3.3).
# CurrentUser\My is fine for dev — no admin elevation needed.
$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $Subject `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -NotAfter (Get-Date).AddDays($ValidityDays)

Write-Host "[dev-cert] thumbprint: $($cert.Thumbprint)"

# Export to .pfx for electron-builder (needs the private key).
$securePassword = ConvertTo-SecureString -String $PfxPassword -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $PfxPath -Password $securePassword | Out-Null

# Export the public-only .cer for inspection / sharing — optional,
# kept gitignored alongside the .pfx.
Export-Certificate -Cert $cert -FilePath $CerPath -Type CERT | Out-Null

Write-Host ""
Write-Host "[dev-cert] ✅ done. To use this cert with electron-builder:"
Write-Host ""
Write-Host "  `$env:CSC_LINK = `"$PfxPath`""
Write-Host "  `$env:CSC_KEY_PASSWORD = `"$PfxPassword`""
Write-Host "  npm run dist:win"
Write-Host ""
Write-Host "[dev-cert] To verify a signed installer afterward:"
Write-Host "  Get-AuthenticodeSignature .\apps\desktop\release\<version>\ConfigForge-Setup-<version>-x64.exe"
