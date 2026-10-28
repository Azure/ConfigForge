// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const packagingGuide = 'docs/src/user-guide/machine-configuration.md';

describe('customer documentation contracts', () => {
  it('leads with downloads and authoring before optional packaging', async () => {
    const readme = await read('README.md');
    const download = readme.indexOf('## Download the right edition');
    const firstBaseline = readme.indexOf('## Create your first baseline');
    const packaging = readme.indexOf('## Export to Azure Machine Configuration');

    expect(download).toBeGreaterThanOrEqual(0);
    expect(firstBaseline).toBeGreaterThan(download);
    expect(packaging).toBeGreaterThan(firstBaseline);
    expect(readme).toContain('not intended for');
    expect(readme).toContain('production use');
    expect(readme).toContain('not an officially supported Microsoft product');
    expect(readme).toContain('https://github.com/Azure/ConfigForge/releases/tag/v0.3.104');
    expect(readme).toContain('https://github.com/Azure/ConfigForge/releases/tag/mac-v0.3.104-author.1');
    expect(readme).not.toContain('mac-v0.3.97-author.1');
  });

  it('states the resource-module minimum on each current packaging entry point', async () => {
    const files = [
      'README.md',
      'INSTALL.md',
      'docs/src/introduction.md',
      'docs/src/quick-start/install-run.md',
      'docs/src/quick-start/authoring-vs-deploying.md',
      'docs/src/user-guide/manifest-editor.md',
      packagingGuide,
      'docs/src/operations/troubleshooting.md',
      'docs/src/reference/glossary.md',
    ];
    for (const file of files) {
      const text = await read(file);
      expect(text, file).toContain('Microsoft.OSConfig');
      expect(text, file).toContain('1.4.10');
      expect(text, file).toContain('PowerShell 7');
      expect(text, file).not.toContain('1.3.11');
    }
  });

  it('fails before MOF replacement when no qualifying installed module exists', async () => {
    const guide = await read(packagingGuide);
    const resolution = guide.match(/```powershell\s+(\$InstalledOSConfig[\s\S]*?)```/)?.[1];
    expect(resolution).toBeDefined();
    expect(resolution).toContain("Where-Object { $_.Version -ge [version]'1.4.10' }");
    expect(resolution).toContain('Sort-Object Version -Descending');
    expect(resolution).toContain('Select-Object -First 1');
    expect(resolution).toMatch(/if \(-not \$InstalledOSConfig\) \{\s+throw /);
    expect(resolution.indexOf('throw ')).toBeLessThan(resolution.indexOf('$MofContent.Replace('));
    expect(resolution).toContain('ModuleVersion = "0.0.0";');
    expect(resolution).toContain('$($InstalledOSConfig.Version)');
    expect(guide).toContain('Install-Module -Name Microsoft.OSConfig -MinimumVersion 1.4.10');
  });

  it('keeps current packages Audit-first without applying the historical helper', async () => {
    const guide = await read(packagingGuide);
    const blocks = [...guide.matchAll(/```powershell\s+([\s\S]*?)```/g)].map((match) => match[1]);
    const create = blocks.find((block) => block.includes('$Package = New-GuestConfigurationPackage'));
    expect(create).toContain('-Type Audit');
    expect(create).not.toContain('AuditAndSet');
    expect(blocks.join('\n')).not.toContain('new-machine-configuration-package.ps1');
    expect(guide).toContain('Do not apply that old patch to 1.4.10+ packages.');
    expect(guide).toContain('Do not modify the ZIP after this step.');
    expect(guide).toContain('The policy contains the package hash.');
    expect(guide).not.toContain('Set-PSRepository');
  });

  it('provides explicit platform-specific DSC setup and validates Windows readiness', async () => {
    const guide = await read(packagingGuide);
    const windows = guide.split('### Windows setup: copy and paste')[1]
      .split('### Ubuntu setup: use instead of the Windows block')[0];
    const linux = guide.split('### Ubuntu setup: use instead of the Windows block')[1]
      .split('### Azure targets')[0];

    expect(windows).toContain("$ErrorActionPreference = 'Stop'");
    expect(windows).toContain("$PSVersionTable.PSVersion -lt [version]'7.1.3'");
    expect(windows).toContain('-not $IsWindows');
    expect(windows).toContain('Get-Command Install-Module -ErrorAction Stop');
    expect(windows).toContain('Get-PSRepository -Name PSGallery -ErrorAction Stop');
    expect(windows).toContain('Install-Module -Name PSDesiredStateConfiguration -RequiredVersion 2.0.7');
    expect(windows).toContain('Import-Module -Name PSDesiredStateConfiguration -RequiredVersion 2.0.7');
    expect(windows).toContain('$LoadedDsc.Version');
    expect(windows).toContain('Get-Command -Name New-GuestConfigurationPackage, Get-GuestConfigurationPackageComplianceStatus');
    expect(windows).toMatch(/if \(-not \$OSConfigModule\) \{\s+throw /);
    expect(windows).not.toContain('3.0.0-beta1');
    expect(linux).toContain('-RequiredVersion 3.0.0-beta1');
    expect(linux).toContain('Import-Module -Name PSDesiredStateConfiguration -RequiredVersion 3.0.0 -ErrorAction Stop');
    expect(linux).not.toContain('Import-Module -Name PSDesiredStateConfiguration -RequiredVersion 3.0.0-beta1');
    expect(linux).toContain('-AllowPrerelease');
    expect(linux).toContain('-not $IsLinux');
  });

  it('creates the export folder before asking for the MOF and refuses package overwrite', async () => {
    const guide = await read(packagingGuide);
    const exportStep = guide.split('## 1. Export the MOF from ConfigForge')[1]
      .split('## 2. Resolve')[0];
    const packageStep = guide.split('## 3. Create the package')[1]
      .split('## 4. Test')[0];

    expect(exportStep.indexOf('New-Item -ItemType Directory')).toBeLessThan(
      exportStep.indexOf('1. Open the baseline'),
    );
    expect(exportStep).toContain("Join-Path (Join-Path $HOME 'ConfigForge') 'MachineConfiguration'");
    expect(exportStep).toContain('Test-Path -LiteralPath $MofPath -PathType Leaf');
    expect(packageStep.indexOf('Test-Path -LiteralPath $ExpectedPackagePath')).toBeLessThan(
      packageStep.indexOf('$Package = New-GuestConfigurationPackage'),
    );
    expect(packageStep).toContain('Test-Path -LiteralPath $Package.Path -PathType Leaf');
    expect(packageStep).toContain('Get-FileHash -LiteralPath $PackagePath -Algorithm SHA256');
    expect(packageStep).not.toContain('-Force');
  });

  it('reestablishes variables and imports in the elevated audit session', async () => {
    const guide = await read(packagingGuide);
    const testStep = guide.split('## 4. Test the package locally')[1]
      .split('**Optional enforcement evaluation:**')[0];
    const code = testStep.match(/```powershell\s+([\s\S]*?)```/)?.[1];

    expect(code).toContain('Import-Module -Name GuestConfiguration -ErrorAction Stop');
    expect(code).toContain("$PackageName = 'ContosoSecurityBaseline_1_0_0'");
    expect(code).toContain('$PackagePath = Join-Path $WorkingDirectory "$PackageName.zip"');
    expect(code.indexOf('Test-Path -LiteralPath $PackagePath')).toBeLessThan(
      code.indexOf('Get-GuestConfigurationPackageComplianceStatus'),
    );
    expect(code).toContain('ConvertTo-Json -Depth 100');
    expect(code).toContain('-not @($AuditResult.resources).Count');
    expect(code).toContain('Set-Content -LiteralPath $AuditReportPath');
    expect(code).not.toContain('Start-GuestConfigurationPackageRemediation');
    expect(testStep).toContain('same user account');
    expect(testStep).toContain("different `$HOME`");
  });

  it('keeps Azure tool installation and resource placeholders in the optional publishing path', async () => {
    const guide = await read(packagingGuide);
    const publishing = guide.split('## 6. Upload the ZIP to Azure Storage')[1]
      .split('## 7. Generate')[0];

    expect(publishing).toContain('Install-Module -Name Az -MinimumVersion 5.9.0');
    expect(publishing).toContain('Import-Module -Name Az.Accounts, Az.Storage, Az.Resources');
    expect(publishing.indexOf("throw 'Replace the subscription")).toBeLessThan(
      publishing.indexOf('Connect-AzAccount\n'),
    );
    expect(guide.slice(0, guide.indexOf('## 5. Optional: sign'))).not.toContain('Connect-AzAccount');
    expect(publishing).toContain('existing');
  });
});
