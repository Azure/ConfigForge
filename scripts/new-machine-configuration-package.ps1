# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

#requires -Version 7.1

[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$Name,

  [Parameter(Mandatory)]
  [ValidateScript({ Test-Path $_ -PathType Leaf })]
  [string]$Configuration,

  [Parameter(Mandatory)]
  [ValidateSet('Audit', 'AuditAndSet')]
  [string]$Type,

  [Parameter(Mandatory)]
  [string]$Path,

  [version]$Version = '1.0.0',

  [ValidateRange(15, 1440)]
  [int]$FrequencyMinutes = 15
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Import-Module GuestConfiguration -ErrorAction Stop

$outputDirectory = New-Item -ItemType Directory -Path $Path -Force
$package = New-GuestConfigurationPackage `
  -Name $Name `
  -Configuration (Get-Item $Configuration) `
  -Version $Version.ToString() `
  -Type $Type `
  -FrequencyMinutes $FrequencyMinutes `
  -Path $outputDirectory `
  -Force

if ($Type -eq 'AuditAndSet') {
  $vulnerableCall =
    'Invoke-Native exec resource --correlation-id $(Get-CorrelationId) ' +
    '--correlation-group $this.CorrelationGroup --mode set --name $this.Name ' +
    '--type $this.type --properties $ResourceProperties'
  $fixedCall =
    'Invoke-Native exec resource --correlation-id $(Get-CorrelationId) ' +
    '--correlation-group $this.CorrelationGroup --mode set --name $this.Name ' +
    '--type $this.type --properties ' +
    '(ConvertTo-Json -InputObject $ResourceProperties -Compress -Depth 32)'
  $targets = @(
    'Modules\Microsoft.OSConfig\classes\OSConfig.ps1',
    'Modules\Microsoft.OSConfig\Microsoft.OSConfig.psm1'
  )
  $temporaryDirectory = Join-Path `
    ([IO.Path]::GetTempPath()) `
    "configforge-machine-configuration-$([guid]::NewGuid().ToString('N'))"

  try {
    Expand-Archive -Path $package.Path -DestinationPath $temporaryDirectory
    $encoding = [Text.UTF8Encoding]::new($false)

    foreach ($relativePath in $targets) {
      $target = Join-Path $temporaryDirectory $relativePath
      if (-not (Test-Path $target -PathType Leaf)) {
        throw "The Machine Configuration package is missing $relativePath."
      }

      $content = [IO.File]::ReadAllText($target)
      $vulnerableCount = [regex]::Matches(
        $content,
        [regex]::Escape($vulnerableCall)
      ).Count
      $fixedCount = [regex]::Matches(
        $content,
        [regex]::Escape($fixedCall)
      ).Count

      if ($vulnerableCount -eq 1 -and $fixedCount -eq 0) {
        [IO.File]::WriteAllText(
          $target,
          $content.Replace($vulnerableCall, $fixedCall),
          $encoding
        )
      } elseif ($vulnerableCount -ne 0 -or $fixedCount -ne 1) {
        throw (
          "Unsupported Microsoft.OSConfig Set wrapper in ${relativePath}: " +
          "vulnerable=$vulnerableCount fixed=$fixedCount."
        )
      }
    }

    $marker = [ordered]@{
      patch = 'Microsoft.OSConfig.SetJsonSerialization'
      reason =
        'The 1.4.3 DSC Set wrapper passes a PSCustomObject to a String[] ' +
        'native boundary. ConfigForge serializes it as compressed JSON.'
      targets = $targets
    }
    $marker |
      ConvertTo-Json -Depth 4 |
      Set-Content `
        -Path (Join-Path $temporaryDirectory 'ConfigForge.compatibility.json') `
        -Encoding utf8NoBOM

    Remove-Item -LiteralPath $package.Path -Force
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory(
      $temporaryDirectory,
      $package.Path,
      [IO.Compression.CompressionLevel]::Optimal,
      $false
    )
  } finally {
    if (Test-Path $temporaryDirectory) {
      Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
    }
  }
}

[pscustomobject]@{
  PSTypeName = 'ConfigForge.MachineConfigurationPackage'
  Name = $package.Name
  Path = $package.Path
  Type = $Type
  Version = $Version.ToString()
  CompatibilityPatch = if ($Type -eq 'AuditAndSet') {
    'Microsoft.OSConfig.SetJsonSerialization'
  } else {
    $null
  }
}
