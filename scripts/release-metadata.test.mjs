// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { access, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

async function exists(path) {
  try {
    await access(new URL(`../${path}`, import.meta.url));
    return true;
  } catch {
    return false;
  }
}

describe('public release metadata', () => {
  it('points packaged auto-updates at the canonical Azure repository', async () => {
    const builder = await read('apps/desktop/electron-builder.yml');
    expect(builder).toMatch(
      /publish:\s*\n\s+provider:\s+github\s*\n\s+owner:\s+Azure\s*\n\s+repo:\s+ConfigForge/m,
    );
    expect(builder).not.toContain('owner: ABMFST');

    const desktopPackage = JSON.parse(await read('apps/desktop/package.json'));
    expect(desktopPackage.homepage).toBe('https://github.com/Azure/ConfigForge');
  });

  it('points the mac author updater at Azure when that flavor config is present', async () => {
    const path = 'apps/desktop/electron-builder.author.yml';
    if (!(await exists(path))) return;

    const builder = await read(path);
    expect(builder).toMatch(
      /publish:\s*\n\s+provider:\s+github\s*\n\s+owner:\s+Azure\s*\n\s+repo:\s+ConfigForge/m,
    );
    expect(builder).not.toContain('owner: ABMFST');
  });

  it('builds mac author artifacts from an explicit immutable tag', async () => {
    const [script, workflow] = await Promise.all([
      read('scripts/ship-mac.ps1'),
      read('.github/workflows/release-mac.yml'),
    ]);

    expect(script).toContain("[ValidatePattern('^mac-v\\d+\\.\\d+\\.\\d+-author\\.\\d+$')]");
    expect(script).toContain('[string]$Repo = "Azure/ConfigForge"');
    expect(script).toMatch(/gh workflow run "Release \(macOS author\)"[\s\S]*?--ref main/);
    expect(workflow).toMatch(
      /uses: actions\/checkout@v4\s+with:\s+ref: \$\{\{ inputs\.release_tag \}\}/m,
    );
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$tag_commit"');
    expect(workflow).toContain('Expected exactly 5 macOS author assets');
    expect(workflow).toContain('gh release create $TAG --draft --verify-tag');
    expect(workflow).not.toContain('default:');
  });

  it('keeps remote lockfile tarballs on the public npm registry', async () => {
    const lockfile = JSON.parse(await read('package-lock.json'));
    const nonPublic = Object.entries(lockfile.packages)
      .filter(([, metadata]) => /^https?:/.test(metadata.resolved ?? ''))
      .filter(([, metadata]) => !metadata.resolved.startsWith('https://registry.npmjs.org/'))
      .map(([path, metadata]) => `${path}: ${metadata.resolved}`);

    expect(nonPublic).toEqual([]);
  });

  it('keeps NOTICE aligned with the legal MIT release filename', async () => {
    const notice = await read('NOTICE');
    expect(notice).toContain('Copyright (c) Microsoft Corporation.');
    expect(notice).toContain('See LICENSE.TXT at the repo root.');
  });

  it('documents every direct runtime dependency and no removed dependency', async () => {
    const [desktopPackage, corePackage, notices] = await Promise.all([
      read('apps/desktop/package.json').then(JSON.parse),
      read('packages/core/package.json').then(JSON.parse),
      read('THIRDPARTYNOTICES.md'),
    ]);
    const direct = new Set([
      ...Object.keys(desktopPackage.dependencies ?? {}),
      ...Object.keys(corePackage.dependencies ?? {}),
    ]);
    const documented = new Set(
      [...notices.matchAll(/\|\s*\d+\s*\|\s*\*\*([^*]+)\*\*\s*\|/g)].map((match) =>
        match[1].trim().toLowerCase(),
      ),
    );

    for (const dependency of direct) {
      expect(documented, `${dependency} missing from THIRDPARTYNOTICES.md`).toContain(
        dependency.toLowerCase(),
      );
    }
    expect(documented).not.toContain('tailwind-merge');
  });
});
