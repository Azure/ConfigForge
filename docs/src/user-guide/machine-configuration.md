# Deploy through Azure Machine Configuration

Use Azure Machine Configuration when you want Azure Policy to evaluate a
ConfigForge baseline on Azure virtual machines or Azure Arc-enabled servers.

This is an **advanced, optional workflow**. To create and share a baseline
without Azure, start with [Your first baseline](../quick-start/first-manifest.md).
The app exports a MOF; the remaining packaging and Azure steps happen outside
ConfigForge.

The deployment path is:

`ConfigForge baseline → MOF → resolved MOF → Machine Configuration ZIP → Azure Storage → policy JSON → Azure Policy definition → policy assignment`

ConfigForge exports the compiled MOF. You do not need to author a separate DSC
configuration.

> ConfigForge is experimental, community-maintained, not officially supported
> by Microsoft, and not intended for production use. Test every package and
> policy on a disposable machine. Azure Machine Configuration's support status
> does not make ConfigForge or a custom baseline an officially supported product.

## Supported behavior

| Package or policy mode                               | Purpose                                        | Current guidance                                                            |
| ---------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------- |
| `Audit`                                              | Report compliance without changing the machine | Recommended default                                                         |
| `AuditAndSet` package + `ApplyAndMonitor` policy     | Apply during remediation, then monitor drift without automatically correcting it | Advanced: validate the exact baseline/module combination before choosing this mode |
| `AuditAndSet` package + `ApplyAndAutoCorrect` policy | Reapply whenever drift is detected             | Advanced: validate remediation and recovery on a disposable machine first |

This walkthrough uses **Audit**. A successful export or package build is not
evidence that every setting can be read or safely enforced.

## Prerequisites

### Packaging machine

Use a Windows or Ubuntu packaging environment with **PowerShell 7**:

- Windows: PowerShell 7.1.3 or later.
- Ubuntu 20+: PowerShell 7.2.4 or later.
- Local Machine Configuration package testing is not supported on macOS.
  Export the MOF in macOS Author, then move it to a Windows/Ubuntu packaging
  and test machine appropriate for the target baseline.

The [Microsoft Learn environment guide](https://learn.microsoft.com/azure/governance/machine-configuration/how-to/develop-custom-package/1-set-up-authoring-environment)
defines the runtime and toolkit requirements. These are separate components:

| Component | Role |
| --- | --- |
| **PowerShell 7** | Runtime in which you run the packaging commands |
| **GuestConfiguration** | Toolkit providing `New-GuestConfigurationPackage`, package testing, and policy generation |
| **Microsoft.OSConfig PowerShell module 1.4.10 or later** | ConfigForge packaging prerequisite: supplies the OSConfig DSC resource that `New-GuestConfigurationPackage` bundles into the ZIP |
| **Az modules** | Azure authentication, Storage, policy definitions, and assignments |

**1.4.10 is the Microsoft.OSConfig module version, not a PowerShell runtime
version or an `oscfg` CLI version.** The module must be installed and visible
in `$env:PSModulePath` on the machine **creating** the package. Installing the
CLI with winget does not satisfy this requirement. Neither module is required
for ordinary ConfigForge authoring.

Install the packaging modules in PowerShell 7 using PowerShellGet:

```powershell
Install-Module -Name GuestConfiguration -Scope CurrentUser -Repository PSGallery
Install-Module -Name Microsoft.OSConfig -MinimumVersion 1.4.10 -Scope CurrentUser -Repository PSGallery
Import-Module GuestConfiguration
Get-Command -Module GuestConfiguration
```

Review any repository trust prompt according to your organization's policy;
you do not need to mark the whole Gallery trusted. Packaging itself does not
require elevation. Local package **testing** does.

GuestConfiguration installs required Az dependencies; Microsoft Learn lists
Azure PowerShell 5.9.0 or later. For the publishing steps below, ensure
`Az.Accounts`, `Az.Storage`, `Az.Resources`, and `Az.PolicyInsights` are available
in that session. Follow your organization's approved installation process if
they are missing.

Complete Learn's platform-specific **PSDesiredStateConfiguration** setup as
part of preparing the environment; it is separate from the Microsoft.OSConfig
resource module. ConfigForge already exports a compiled MOF, so you can skip
writing and compiling a separate DSC configuration for this walkthrough.

List qualifying resource-module versions:

```powershell
Get-Module -ListAvailable -Name Microsoft.OSConfig |
  Where-Object { $_.Version -ge [version]'1.4.10' } |
  Sort-Object Version -Descending |
  Select-Object Name, Version, ModuleBase
```

The [1.4.10 Gallery release](https://www.powershellgallery.com/packages/Microsoft.OSConfig/1.4.10)
is available. The **1.4.10+ minimum is the current ConfigForge packaging
requirement**, not a claim that all upstream baseline or remediation issues
are resolved. Validate the exact installed module and baseline you package;
historical validation against 1.4.3 does not replace this prerequisite.

### Azure targets (needed only when assigning the policy)

Target machines need:

- The Machine Configuration extension for Azure VMs, or Azure Connected
  Machine agent for Arc-enabled servers. Applying configurations requires
  extension 1.26.24+ or Arc agent 1.10.0+.
- A system-assigned managed identity when required by the selected policy.
- The built-in initiative **Deploy prerequisites to enable machine
  configuration policies on virtual machines** assigned at or above the target
  Azure VM scope. Arc-enabled servers have a separate onboarding path.

## 1. Export the MOF from ConfigForge

1. Open the baseline in **Baseline Detail**.
2. Select **Export**.
3. Select **MOF (`.mof`)**.
4. Save the file in a versioned working folder.

The examples below use a **Windows baseline on a Windows packaging/test
machine**. For Linux content, use a compatible Ubuntu environment, Linux
baseline/resources, an appropriate working directory, and `Platform = 'Linux'`
when generating the policy. Do not test Windows resources on a Linux host.

```powershell
$WorkingDirectory = 'C:\ConfigForge\MachineConfiguration'
$MofPath = Join-Path $WorkingDirectory 'ContosoSecurityBaseline.mof'
$PackageName = 'ContosoSecurityBaseline_1_0_0'

New-Item -ItemType Directory -Path $WorkingDirectory -Force | Out-Null
if (-not (Test-Path -LiteralPath $MofPath -PathType Leaf)) {
  throw "Export the baseline MOF to $MofPath before continuing."
}
```

Use a unique package name for every baseline release. Reusing package names or
content URIs can leave Azure evaluating cached content.

## 2. Resolve the Microsoft.OSConfig module version

ConfigForge exports:

```text
ModuleName = "Microsoft.OSConfig";
ModuleVersion = "0.0.0";
```

`0.0.0` is a portable placeholder so the same exported MOF can move between
customer environments. Machine Configuration runtime requires the exact
module version bundled into the ZIP, so resolve the placeholder on a packaging
copy before running `New-GuestConfigurationPackage`. Select the newest installed
version that meets the **1.4.10 minimum**, and fail before editing the MOF if
none is available. Keep the selected module installed until packaging finishes.

```powershell
$InstalledOSConfig = Get-Module -ListAvailable -Name Microsoft.OSConfig |
  Where-Object { $_.Version -ge [version]'1.4.10' } |
  Sort-Object Version -Descending |
  Select-Object -First 1

if (-not $InstalledOSConfig) {
  throw 'Microsoft.OSConfig 1.4.10 or later is required on the packaging machine.'
}

$ResolvedMofPath = Join-Path $WorkingDirectory `
  'ContosoSecurityBaseline.resolved.mof'

$MofContent = Get-Content -LiteralPath $MofPath -Raw -ErrorAction Stop
if (-not $MofContent.Contains('ModuleVersion = "0.0.0";')) {
  throw 'Expected a fresh ConfigForge export with ModuleVersion = "0.0.0"; re-export the MOF.'
}

$MofContent.Replace(
  'ModuleVersion = "0.0.0";',
  "ModuleVersion = `"$($InstalledOSConfig.Version)`";"
) | Set-Content -LiteralPath $ResolvedMofPath -Encoding utf8 -ErrorAction Stop

$InstalledOSConfig | Select-Object Name, Version, ModuleBase
```

Confirm that every OSConfig instance was resolved:

```powershell
Select-String -Path $ResolvedMofPath -Pattern 'ModuleVersion'
```

Do not replace `ModuleName = "Microsoft.OSConfig"` or leave a version range
in the MOF. It must name the **exact installed version**, not simply the
minimum. Record that version with the baseline and package release so you can
reproduce and diagnose the package later.

## 3. Create the package

Create an Audit package with the **GuestConfiguration** cmdlet:

```powershell
$Package = New-GuestConfigurationPackage `
  -Name $PackageName `
  -Configuration $ResolvedMofPath `
  -Type Audit `
  -Path $WorkingDirectory

$PackagePath = $Package.Path
Get-Item $PackagePath
```

The source baseline, exact module version, and package name together identify
what you are testing. Use a new name/version for changed content; do not
overwrite a published ZIP.

The ZIP contains:

- The resolved MOF.
- Guest Configuration runtime metadata.
- The installed Microsoft.OSConfig module.

Do not include secrets or confidential content. Keep the uncompressed package
below 100 MB.

### Historical 1.4.3 compatibility helper

The repository retains
[`scripts/new-machine-configuration-package.ps1`](https://github.com/Azure/ConfigForge/blob/main/scripts/new-machine-configuration-package.ps1)
and its tests for the historical Microsoft.OSConfig **1.4.3** `Set()`
serialization workaround. It patched the packaged wrapper copies, not the
globally installed module.

**Do not apply that old patch to 1.4.10+ packages.** It is not part of this
current packaging walkthrough and is not evidence that a newer module needs
the same workaround. If a new package fails, capture the exact module version
and non-sensitive error details, then investigate rather than modifying the ZIP.

## 4. Test the package locally

Run local tests from an elevated PowerShell 7 session on Windows or through
`sudo pwsh` on Linux:

```powershell
Get-GuestConfigurationPackageComplianceStatus -Path $PackagePath
```

The first run installs the local Machine Configuration test agent. The result
should include one resource result for every Test wrapper in the exported
baseline.

For example, the ConfigForge Windows Server 2025 Workgroup Member baseline
produces 296 resource results.

Inspect unread/error results as well as the total count. A completed command
alone is not a passing audit. Preserve the report alongside the exact package
and module version. These instructions are not a live-test record for your
environment or for every 1.4.10+ module/baseline combination.

**Optional enforcement evaluation:** only after reviewing the baseline and
Audit results, create a separate package with `-Type AuditAndSet`. The next
command **changes the local machine**. Use a disposable matching-platform
machine with a recovery plan; do not run it on your authoring workstation.
Set the following path to your separately created `AuditAndSet` ZIP (not the
Audit package from step 3):

```powershell
$EnforcementPackagePath = '<path-to-your-auditandset-package.zip>'

Start-GuestConfigurationPackageRemediation `
  -Path $EnforcementPackagePath `
  -Verbose

Get-GuestConfigurationPackageComplianceStatus -Path $EnforcementPackagePath
```

## 5. Optional: sign the package

Machine Configuration always validates the package SHA-256 hash. Package
signing is optional unless your organization requires certificate or GPG
validation.

Run `Protect-GuestConfigurationPackage` before upload and before policy
generation.

Windows example:

```powershell
$Certificate = Get-ChildItem Cert:\LocalMachine\My |
  Where-Object {
    $_.EnhancedKeyUsageList.FriendlyName -contains 'Code Signing'
  } |
  Select-Object -First 1

Protect-GuestConfigurationPackage `
  -Path $PackagePath `
  -Certificate $Certificate `
  -Verbose
```

Signed-package enforcement also requires distributing the public certificate
and configuring target-machine certificate validation.

## 6. Upload the ZIP to Azure Storage

`Publish-GuestConfigurationPackage` is not part of GuestConfiguration 4.11.0.
Upload the ZIP with `Set-AzStorageBlobContent`.

The following example uses a private container and a read-only SAS URI:

```powershell
$SubscriptionId = '<subscription-id>'
$StorageResourceGroup = '<storage-resource-group>'
$StorageAccountName = '<storage-account-name>'
$ContainerName = 'machine-configuration'

Connect-AzAccount
Set-AzContext -SubscriptionId $SubscriptionId

$StorageKey = (
  Get-AzStorageAccountKey `
    -ResourceGroupName $StorageResourceGroup `
    -Name $StorageAccountName |
  Select-Object -First 1
).Value

$StorageContext = New-AzStorageContext `
  -StorageAccountName $StorageAccountName `
  -StorageAccountKey $StorageKey

if (-not (Get-AzStorageContainer `
    -Name $ContainerName `
    -Context $StorageContext `
    -ErrorAction SilentlyContinue)) {
  New-AzStorageContainer `
    -Name $ContainerName `
    -Context $StorageContext | Out-Null
}

$BlobName = Split-Path $PackagePath -Leaf

if (Get-AzStorageBlob -Container $ContainerName -Blob $BlobName `
    -Context $StorageContext -ErrorAction SilentlyContinue) {
  throw 'This blob name already exists. Use a new package name/version; do not overwrite it.'
}

Set-AzStorageBlobContent `
  -Container $ContainerName `
  -File $PackagePath `
  -Blob $BlobName `
  -Context $StorageContext `
  -ErrorAction Stop | Out-Null

$StartTime = (Get-Date).AddMinutes(-5)
$ExpiryTime = $StartTime.AddYears(1)

$ContentUri = New-AzStorageBlobSASToken `
  -StartTime $StartTime `
  -ExpiryTime $ExpiryTime `
  -Container $ContainerName `
  -Blob $BlobName `
  -Permission r `
  -Context $StorageContext `
  -FullUri
```

Treat a SAS URI as a secret. Do not commit it to source control.

For private access without SAS:

- Azure VMs can use a system-assigned or user-assigned identity with
  **Storage Blob Data Reader**.
- Azure Arc package downloads do not support user-assigned identity in this
  scenario. Use SAS or system-assigned identity.

## 7. Generate the Machine Configuration policy

Generate an Audit policy:

```powershell
$PolicyOutputPath = Join-Path $WorkingDirectory 'policy'
New-Item -ItemType Directory -Path $PolicyOutputPath -Force | Out-Null

$PolicyConfig = @{
  PolicyId      = (New-Guid).Guid
  ContentUri    = $ContentUri
  DisplayName   = 'Contoso security baseline'
  Description   = 'Audits the ConfigForge security baseline.'
  Path          = $PolicyOutputPath
  Platform      = 'Windows'
  PolicyVersion = [version]'1.0.0'
  Mode          = 'Audit'
}

$PolicyResult = New-GuestConfigurationPolicy @PolicyConfig
$PolicyFile = $PolicyResult.Path
Get-Item $PolicyFile
```

`New-GuestConfigurationPolicy -Path` expects an output folder, not the package
path. Use the returned `Path` instead of constructing the policy filename.

Audit mode produces an `_AuditIfNotExists.json` file. Apply modes produce a
`_DeployIfNotExists.json` file.

Do not modify the ZIP after this step. The policy contains the package hash. If
the package changes, upload the new ZIP and regenerate the policy.

## 8. Publish the Azure Policy definition

Creating a policy definition typically requires **Resource Policy
Contributor** or equivalent permissions.

```powershell
$PolicyDefinition = New-AzPolicyDefinition `
  -Name 'configforge-contoso-security-baseline-1-0-0' `
  -DisplayName 'Contoso security baseline' `
  -Description 'Machine Configuration policy generated from ConfigForge.' `
  -Policy $PolicyFile
```

The definition appears under **Azure Policy > Definitions**.

## 9. Assign the policy

For Azure VMs, assign the prerequisite initiative first:

**Deploy prerequisites to enable machine configuration policies on virtual
machines**

Then assign the custom Audit policy:

```powershell
$TargetResourceGroupName = '<target-resource-group>'
$Scope = (Get-AzResourceGroup -Name $TargetResourceGroupName).ResourceId

$Assignment = New-AzPolicyAssignment `
  -Name 'configforge-contoso-audit' `
  -DisplayName 'ConfigForge - Contoso baseline audit' `
  -Scope $Scope `
  -PolicyDefinition $PolicyDefinition
```

For DeployIfNotExists policies, the assignment needs a managed identity,
location, and the roles declared in the generated policy's
`roleDefinitionIds`. The Azure portal's **Create a remediation task** flow is
the simplest way to create the identity and required role assignments.

## 10. Verify the deployment

1. Open **Azure Policy > Compliance**.
2. Locate the custom assignment.
3. Confirm that the prerequisite initiative is compliant.
4. Confirm that Azure created a guest configuration assignment on the target
   VM or Arc-enabled server.
5. Wait for package download, extraction, and the first consistency scan.
6. Open the guest assignment report and confirm that the resource count matches
   the exported baseline.

Machine Configuration evaluation is asynchronous. Policy state can initially
show NonCompliant while the guest assignment is still Pending.

## Troubleshooting

| Symptom                                                                            | Resolution                                                                                                            |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Publish-GuestConfigurationPackage` is not recognized                              | Upload with `Set-AzStorageBlobContent`.                                                                               |
| No qualifying `Microsoft.OSConfig` module is found                                 | Install **1.4.10 or later** in the packaging session's PowerShell 7 module path, then rerun resolution and create a new ZIP. Installing the CLI is not sufficient. |
| More than one Microsoft.OSConfig version is installed                              | Resolution selects the newest installed version **at least 1.4.10**. Record it and verify that exact version is bundled; older copies do not satisfy the minimum. |
| Runtime says module version `0.0.0` does not exist                                 | Package the resolved MOF, not the portable exported MOF.                                                              |
| Deployment reports `missing field keyPath` with properties like `{"@{keyPath": ...}` | Check the module version inside the ZIP and the exported properties. Rebuild old packages using the current prerequisite, resolve the MOF, and retest. Do not apply the historical 1.4.3 patch to 1.4.10+; report remaining failures with a minimal non-sensitive reproduction. |
| Local compliance fails with access errors                                          | Run PowerShell 7 elevated or through `sudo`.                                                                          |
| Package download returns HTTP 403                                                  | Renew the SAS URI or correct Storage Blob Data Reader access.                                                         |
| The extension rejects the package hash                                             | Upload a new ZIP and regenerate the policy. Do not alter the existing ZIP.                                            |
| Remediation does not start                                                         | Check the assignment identity, resource-group deployment permissions, role assignments, and remediation task.         |
| Package exceeds its size limit                                                     | Reduce package content; keep the uncompressed package below 100 MB.                                                   |

## Microsoft Learn references

- [Microsoft.OSConfig 1.4.10 on PowerShell Gallery](https://www.powershellgallery.com/packages/Microsoft.OSConfig/1.4.10) — module availability; the minimum above is ConfigForge guidance.
- [Install-Module parameters (PowerShellGet)](https://learn.microsoft.com/powershell/module/powershellget/install-module?view=powershellget-2.x) — `-MinimumVersion` selects that version or later.
- [Develop a custom Machine Configuration package](https://learn.microsoft.com/azure/governance/machine-configuration/how-to/develop-custom-package/overview)
- [Set up the authoring environment](https://learn.microsoft.com/azure/governance/machine-configuration/how-to/develop-custom-package/1-set-up-authoring-environment)
- [Create the package](https://learn.microsoft.com/azure/governance/machine-configuration/how-to/develop-custom-package/2-create-package)
- [Test the package](https://learn.microsoft.com/azure/governance/machine-configuration/how-to/develop-custom-package/3-test-package)
- [Publish the package](https://learn.microsoft.com/azure/governance/machine-configuration/how-to/develop-custom-package/4-publish-package)
- [Create and publish a custom policy definition](https://learn.microsoft.com/azure/governance/machine-configuration/how-to/create-policy-definition)
- [Assign a policy with Azure PowerShell](https://learn.microsoft.com/azure/governance/policy/assign-policy-powershell)
