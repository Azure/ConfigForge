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
    const resolution = [...guide.matchAll(/```powershell\s+([\s\S]*?)```/g)]
      .map((match) => match[1])
      .find((block) => block.includes('$InstalledOSConfig ='));
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
    const create = blocks.find((block) => block.includes('New-GuestConfigurationPackage'));
    expect(create).toContain('-Type Audit');
    expect(create).not.toContain('AuditAndSet');
    expect(create).not.toContain('-Force');
    expect(blocks.join('\n')).not.toContain('new-machine-configuration-package.ps1');
    expect(guide).toContain('Do not apply that old patch to 1.4.10+ packages.');
    expect(guide).toContain('keep the ZIP and its URI unchanged');
    expect(guide.replace(/\s+/g, ' ')).toContain('The policy contains the package hash.');
    expect(guide).not.toContain('Set-PSRepository');
  });

  it('keeps the Windows prerequisites to two module installation commands', async () => {
    const guide = await read(packagingGuide);
    const prerequisites = guide.split('## Prerequisites')[1]
      .split('## 1. Export')[0];
    const blocks = [...prerequisites.matchAll(/```powershell\s+([\s\S]*?)```/g)];

    expect(blocks).toHaveLength(1);
    expect(blocks[0][1].trim().split(/\r?\n/)).toEqual([
      'Install-Module -Name GuestConfiguration -Scope CurrentUser -Repository PSGallery',
      'Install-Module -Name Microsoft.OSConfig -MinimumVersion 1.4.10 -Scope CurrentUser -Repository PSGallery',
    ]);
    expect(prerequisites.replace(/\s+/g, ' ')).toContain(
      'module installation is **not required for this Windows packaging path**',
    );
    expect(guide).not.toContain('Install-Module -Name PSDesiredStateConfiguration');
    expect(guide).not.toContain('Import-Module -Name PSDesiredStateConfiguration');
    expect(prerequisites).toContain('Microsoft Learn authoring guidance');
  });

  it('uses only three packaging steps and preserves the source MOF', async () => {
    const guide = await read(packagingGuide);
    const steps = [...guide.matchAll(/^## \d+\. (.+)$/gm)].map((match) => match[1]);
    const blocks = [...guide.matchAll(/```powershell\s+([\s\S]*?)```/g)]
      .map((match) => match[1]);
    const resolution = blocks.find((block) => block.includes('$InstalledOSConfig ='));
    const create = blocks.find((block) => block.includes('New-GuestConfigurationPackage'));

    expect(steps).toEqual([
      'Export the MOF from ConfigForge',
      'Resolve the Microsoft.OSConfig module version',
      'Create the package',
    ]);
    expect(blocks).toHaveLength(3);
    expect(resolution).toContain("$ErrorActionPreference = 'Stop'");
    expect(resolution).toContain("Resolve-Path -LiteralPath '.\\Baseline.mof'");
    expect(resolution).toContain('$WorkingDirectory = Split-Path -Parent $MofPath');
    expect(resolution).toContain('Set-Content -LiteralPath $ResolvedMofPath');
    expect(resolution).not.toContain('Set-Content -LiteralPath $MofPath');
    expect(create).toContain('Import-Module -Name GuestConfiguration -ErrorAction Stop');
    expect(create).toContain('-Configuration $ResolvedMofPath');
    expect(create).toContain('-Path $WorkingDirectory');
    expect(guide).toContain('**same session**');
  });

  it('links testing and Azure deployment as optional follow-ups instead of expanding setup', async () => {
    const guide = await read(packagingGuide);
    const optional = guide.split('## Optional next steps')[1]
      .split('## Troubleshooting')[0];

    expect(optional).toContain('/3-test-package');
    expect(optional).toContain('/4-publish-package');
    expect(optional).toContain('/how-to/create-policy-definition');
    expect(optional).toContain('/policy/assign-policy-powershell');
    expect(optional).toContain('Testing requires elevation');
    expect(optional).not.toContain('```powershell');
    expect(guide).not.toContain('Connect-AzAccount');
    expect(guide).not.toContain('Install-Module -Name Az');
    expect(guide).not.toContain('Start-GuestConfigurationPackageRemediation');
  });
});
