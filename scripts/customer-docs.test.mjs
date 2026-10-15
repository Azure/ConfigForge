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
    expect(readme).toContain('https://github.com/Azure/ConfigForge/releases/tag/v0.3.103');
    expect(readme).toContain('https://github.com/Azure/ConfigForge/releases/tag/mac-v0.3.101-author.1');
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
});
