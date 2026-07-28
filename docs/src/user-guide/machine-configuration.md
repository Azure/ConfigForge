# Deploy through Azure Machine Configuration

Use Azure Machine Configuration when you want Azure Policy to evaluate a
ConfigForge baseline on Azure virtual machines or Azure Arc-enabled servers.

The deployment path is:

`ConfigForge baseline → MOF → resolved MOF → Machine Configuration ZIP → Azure Storage → policy JSON → Azure Policy definition → policy assignment`

ConfigForge exports the compiled MOF. You do not need to author a separate DSC
configuration.

> ConfigForge is an experimental community tool. Test every package and policy
> on a disposable machine before assigning it broadly.

## Supported behavior

| Package or policy mode                               | Purpose                                        | Current guidance                                                            |
| ---------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------- |
| `Audit`                                              | Report compliance without changing the machine | Recommended default                                                         |
| `AuditAndSet` package + `ApplyAndMonitor` policy     | Apply once during remediation, then monitor    | Use only with a Microsoft.OSConfig version whose `Set()` path you validated |
| `AuditAndSet` package + `ApplyAndAutoCorrect` policy | Reapply whenever drift is detected             | Use only with a validated Microsoft.OSConfig remediation path               |

Microsoft.OSConfig 1.3.11 audits ConfigForge packages successfully, but its
PowerShell DSC resource has an upstream `Set()` serialization defect. The
examples below therefore use `Audit`.

## Prerequisites

Use PowerShell 7:

- Windows: PowerShell 7.1.3 or later.
- Linux: PowerShell 7.2.4 or later.
- Local Machine Configuration package testing is not supported on macOS.
  Export the MOF on macOS, then move it to a supported packaging machine.

Install the packaging and Azure modules:

```powershell
Set-PSRepository -Name PSGallery -InstallationPolicy Trusted

Install-Module GuestConfiguration -Scope CurrentUser -Force
Install-Module Microsoft.OSConfig -Scope CurrentUser -Force

Install-Module Az.Accounts -Scope CurrentUser -Force
Install-Module Az.Storage -Scope CurrentUser -Force
Install-Module Az.Resources -Scope CurrentUser -Force
Install-Module Az.PolicyInsights -Scope CurrentUser -Force
```

Confirm which Microsoft.OSConfig version packaging will use:

```powershell
Get-Module -ListAvailable Microsoft.OSConfig |
  Sort-Object Version -Descending |
  Select-Object Name, Version, ModuleBase
```

Target machines need:

- Azure VM Guest Configuration extension 1.26.24 or later, or Azure Arc agent
  1.10.0 or later.
- A system-assigned managed identity when required by the selected policy.
- The built-in initiative **Deploy prerequisites to enable machine
  configuration policies on virtual machines** assigned at or above the target
  scope.

## 1. Export the MOF from ConfigForge

1. Open the baseline in **Baseline Detail**.
2. Select **Export**.
3. Select **MOF (`.mof`)**.
4. Save the file in a versioned working folder.

Example:

```powershell
$WorkingDirectory = 'C:\ConfigForge\MachineConfiguration'
$MofPath = Join-Path $WorkingDirectory 'ContosoSecurityBaseline.mof'
$PackageName = 'ContosoSecurityBaseline_1_0_0'

New-Item -ItemType Directory -Path $WorkingDirectory -Force | Out-Null
Test-Path $MofPath
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
copy before running `New-GuestConfigurationPackage`.

```powershell
$InstalledOSConfig = Get-Module -ListAvailable Microsoft.OSConfig |
  Sort-Object Version -Descending |
  Select-Object -First 1

if (-not $InstalledOSConfig) {
  throw 'Microsoft.OSConfig is not installed.'
}

$ResolvedMofPath = Join-Path $WorkingDirectory `
  'ContosoSecurityBaseline.resolved.mof'

(Get-Content $MofPath -Raw).Replace(
  'ModuleVersion = "0.0.0";',
  "ModuleVersion = `"$($InstalledOSConfig.Version)`";"
) | Set-Content $ResolvedMofPath -Encoding utf8
```

Confirm that every OSConfig instance was resolved:

```powershell
Select-String -Path $ResolvedMofPath -Pattern 'ModuleVersion'
```

Do not replace `ModuleName = "Microsoft.OSConfig"`.

## 3. Create the package

Create an Audit package:

```powershell
Import-Module GuestConfiguration

$Package = New-GuestConfigurationPackage `
  -Name $PackageName `
  -Configuration $ResolvedMofPath `
  -Type Audit `
  -Path $WorkingDirectory `
  -Force

$PackagePath = $Package.Path
Get-Item $PackagePath
```

The ZIP contains:

- The resolved MOF.
- Guest Configuration runtime metadata.
- The installed Microsoft.OSConfig module.

Keep the uncompressed package below 100 MB.

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

If you use a newer Microsoft.OSConfig version with a validated remediation
path, recreate the package as `AuditAndSet`, then test remediation only on a
disposable machine:

```powershell
Start-GuestConfigurationPackageRemediation `
  -Path $PackagePath `
  -Verbose

Get-GuestConfigurationPackageComplianceStatus -Path $PackagePath
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

Set-AzStorageBlobContent `
  -Container $ContainerName `
  -File $PackagePath `
  -Blob $BlobName `
  -Context $StorageContext `
  -Force | Out-Null

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

Assign the prerequisite initiative first:

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
| `Microsoft.OSConfig` cannot be found                                               | Install it in the PowerShell 7 module path and recreate the ZIP.                                                      |
| More than one Microsoft.OSConfig version is installed                              | The resolution step selects the newest version. Remove older copies if you require a different deterministic version. |
| Runtime says module version `0.0.0` does not exist                                 | Package the resolved MOF, not the portable exported MOF.                                                              |
| Package audits but remediation does not change values on Microsoft.OSConfig 1.3.11 | Use Audit or package with a newer version whose `Set()` path you validated.                                           |
| Local compliance fails with access errors                                          | Run PowerShell 7 elevated or through `sudo`.                                                                          |
| Package download returns HTTP 403                                                  | Renew the SAS URI or correct Storage Blob Data Reader access.                                                         |
| The extension rejects the package hash                                             | Upload a new ZIP and regenerate the policy. Do not alter the existing ZIP.                                            |
| Remediation does not start                                                         | Check the assignment identity, resource-group deployment permissions, role assignments, and remediation task.         |
| Package exceeds its size limit                                                     | Reduce package content; keep the uncompressed package below 100 MB.                                                   |

## Microsoft Learn references

- [Develop a custom Machine Configuration package](https://learn.microsoft.com/azure/governance/machine-configuration/how-to/develop-custom-package/overview)
- [Set up the authoring environment](https://learn.microsoft.com/azure/governance/machine-configuration/how-to/develop-custom-package/1-set-up-authoring-environment)
- [Create the package](https://learn.microsoft.com/azure/governance/machine-configuration/how-to/develop-custom-package/2-create-package)
- [Test the package](https://learn.microsoft.com/azure/governance/machine-configuration/how-to/develop-custom-package/3-test-package)
- [Publish the package](https://learn.microsoft.com/azure/governance/machine-configuration/how-to/develop-custom-package/4-publish-package)
- [Create and publish a custom policy definition](https://learn.microsoft.com/azure/governance/machine-configuration/how-to/create-policy-definition)
- [Assign a policy with Azure PowerShell](https://learn.microsoft.com/azure/governance/policy/assign-policy-powershell)
