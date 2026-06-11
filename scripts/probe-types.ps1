# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot
$oscfg = Join-Path $repoRoot "resources\oscfg\win32-x64\oscfg.exe"
$out = Join-Path $repoRoot "types-probe.log"
Set-Content -Path $out -Value "=== type probe $(Get-Date -Format o) ==="
function Log($m) { Add-Content -Path $out -Value $m }
function Probe($type) {
  Log ""
  Log "--- type: $type ---"
  $r = & $oscfg exec resource --mode list --type $type --output json 2>&1 | Out-String
  Log "EXIT: $LASTEXITCODE"
  Log $r.Trim()
}

# Known-good from live dumps
Probe 'Microsoft.Windows/CSP'
Probe 'Microsoft.Windows/Registry'
Probe 'Microsoft.OSConfig/Test'

# Candidates based on OSConfig conventions
Probe 'Microsoft.Windows/File'
Probe 'Microsoft.Windows/Service'
Probe 'Microsoft.Windows/Command'
Probe 'Microsoft.Windows/LocalUser'
Probe 'Microsoft.Windows/LocalGroup'
Probe 'Microsoft.Windows/Feature'
Probe 'Microsoft.Windows/AuditPolicy'
Probe 'Microsoft.Windows/SecurityOption'
Probe 'Microsoft.Windows/UserRights'
Probe 'Microsoft.Windows/TimeZone'
Probe 'Microsoft.Windows/Firewall'
Probe 'Microsoft.Linux/File'
Probe 'Microsoft.Linux/Package'
Probe 'Microsoft.Linux/Service'
Probe 'Microsoft.Linux/Command'
Probe 'Microsoft.Linux/User'
Probe 'Microsoft.Linux/Group'
Probe 'Microsoft.OSConfig/Sequence'
Probe 'Microsoft.OSConfig/Parallel'
Probe 'Microsoft.OSConfig/Package'
Probe 'Microsoft.OSConfig/Script'
Probe 'Microsoft.OSConfig/Reboot'
Log ""
Log "DONE"
