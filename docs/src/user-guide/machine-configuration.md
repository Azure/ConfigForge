# Create a Machine Configuration package

Create an **Audit-only ZIP** from the compiled Managed Object Format (MOF)
file exported by ConfigForge. No Azure connection or administrator rights
are needed to create the package.

## Prerequisites

On the Windows machine creating the package, you need:

- **PowerShell 7** (`pwsh`), using a currently supported release.
- The **GuestConfiguration** PowerShell module.
- The **Microsoft.OSConfig PowerShell module 1.4.10 or later**.

Install the two modules once in PowerShell 7:

```powershell
Install-Module -Name GuestConfiguration -Scope CurrentUser -Repository PSGallery
Install-Module -Name Microsoft.OSConfig -MinimumVersion 1.4.10 -Scope CurrentUser -Repository PSGallery
```

Review any Gallery trust prompt according to your organization's policy.
**1.4.10 is the OSConfig module version**, not the PowerShell or `oscfg` CLI
version. The CLI does not replace this module.

ConfigForge already compiles the MOF. A separate
`PSDesiredStateConfiguration` module installation is **not required for this
Windows packaging path**. If you author your own DSC configurations or package
Linux content, follow the applicable
[Microsoft Learn authoring guidance](https://learn.microsoft.com/azure/governance/machine-configuration/how-to/develop-custom-package/1-set-up-authoring-environment).
You can export from macOS Author, then transfer the MOF to the packaging machine.

## 1. Export the MOF from ConfigForge

Open **Baseline Detail > Export > MOF (`.mof`)** and save the file.

Open PowerShell 7 in the folder containing that file. Run steps 2 and 3 in
the **same session**. Change the filename and package name below as needed.

## 2. Resolve the Microsoft.OSConfig module version

The exported MOF uses `ModuleVersion = "0.0.0";` as a portable placeholder.
Replace it with the exact installed version on a copy; keep your original
export unchanged.

```powershell
$ErrorActionPreference = 'Stop'
$MofPath = (Resolve-Path -LiteralPath '.\Baseline.mof').Path
$PackageName = 'Baseline_1_0_0'
$WorkingDirectory = Split-Path -Parent $MofPath

$InstalledOSConfig = Get-Module -ListAvailable -Name Microsoft.OSConfig |
  Where-Object { $_.Version -ge [version]'1.4.10' } |
  Sort-Object Version -Descending |
  Select-Object -First 1

if (-not $InstalledOSConfig) {
  throw 'Install Microsoft.OSConfig 1.4.10 or later before creating the package.'
}

$MofContent = Get-Content -LiteralPath $MofPath -Raw
if (-not $MofContent.Contains('ModuleVersion = "0.0.0";')) {
  throw 'Expected a fresh ConfigForge MOF export with the 0.0.0 module-version placeholder.'
}

$ResolvedMofPath = Join-Path $WorkingDirectory "$PackageName.resolved.mof"
$MofContent.Replace(
  'ModuleVersion = "0.0.0";',
  "ModuleVersion = `"$($InstalledOSConfig.Version)`";"
) | Set-Content -LiteralPath $ResolvedMofPath -Encoding utf8
```

## 3. Create the package

```powershell
Import-Module -Name GuestConfiguration -ErrorAction Stop

New-GuestConfigurationPackage `
  -Name $PackageName `
  -Configuration $ResolvedMofPath `
  -Type Audit `
  -Path $WorkingDirectory `
  -ErrorAction Stop
```

**Done:** the command prints the path to `Baseline_1_0_0.zip` alongside your
MOF. Creating this package does not apply the baseline.

Use a new package name/version for changed content. The command refuses to
overwrite an existing ZIP unless you explicitly add `-Force`; do not overwrite
a published package. Do not include secrets in the package.

## Optional next steps

- **Test before deployment:** follow
  [Microsoft Learn's local package test](https://learn.microsoft.com/azure/governance/machine-configuration/how-to/develop-custom-package/3-test-package)
  on a disposable machine matching the baseline. Testing requires elevation
  and installs a test agent; review per-resource errors as well as compliance.
- **Publish to Azure:** follow
  [host or sign the package](https://learn.microsoft.com/azure/governance/machine-configuration/how-to/develop-custom-package/4-publish-package),
  [create the policy](https://learn.microsoft.com/azure/governance/machine-configuration/how-to/create-policy-definition),
  and [assign it](https://learn.microsoft.com/azure/governance/policy/assign-policy-powershell).
  Azure permissions and tooling are needed here, not for ZIP creation.

After policy generation, keep the ZIP and its URI unchanged. The policy
contains the package hash.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| No qualifying OSConfig module is found | Install or update the PowerShell module to **1.4.10+** in the packaging account's PowerShell 7 environment. |
| The MOF file cannot be found | Run from its folder or set `$MofPath` to its actual full path. |
| The runtime requests module version `0.0.0` | Package the resolved copy from step 2, not the original export. |
| The ZIP already exists | Choose a new `$PackageName` and rerun steps 2-3. |

The repository's old 1.4.3 compatibility patch is historical.
Do not apply that old patch to 1.4.10+ packages.

> ConfigForge is experimental, community-maintained, not officially supported
> by Microsoft, and not intended for production use. A successful package
> build does not prove that every baseline setting is compliant or enforceable.
