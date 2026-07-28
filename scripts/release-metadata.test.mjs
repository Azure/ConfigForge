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
    expect(builder).not.toContain('_baselines/cis/_data');
    expect(builder).toContain('!_baselines/cis/**');

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
    expect(builder).toContain('arch: [arm64]');
    expect(builder).not.toContain('Rosetta');
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
      /uses: actions\/checkout@v4\s*\r?\n\s+with:\s*\r?\n\s+ref: \$\{\{ inputs\.release_tag \}\}/m,
    );
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$tag_commit"');
    expect(workflow).toContain('Expected exactly 5 macOS author assets');
    expect(workflow).toContain('gh release create $TAG --draft --verify-tag');
    expect(workflow).toContain('shasum -a 256 "$file"');
    expect(workflow).not.toContain('sha256sum');
    expect(workflow).not.toContain('sort -z');
    expect(workflow).not.toContain('default:');
  });

  it('keeps remote lockfile tarballs on the public npm registry', async () => {
    const lockfile = JSON.parse(await read('package-lock.json'));
    const nonPublic = Object.entries(lockfile.packages)
      .filter(([, metadata]) => /^https?:/.test(metadata.resolved ?? ''))
      .filter(([, metadata]) => !metadata.resolved.startsWith('https://registry.npmjs.org/'))
      .map(([packagePath]) => packagePath);

    expect(nonPublic).toEqual([]);
  });

  it('pins patched brace-expansion 5.x metadata', async () => {
    const [packageJson, lockfile] = await Promise.all([
      read('package.json').then(JSON.parse),
      read('package-lock.json').then(JSON.parse),
    ]);

    expect(packageJson.overrides['brace-expansion@5']).toBe('5.0.8');
    // Partial matcher narrowed to only the security-relevant fields: the
    // patched version, its registry tarball URL, its integrity hash, and
    // dev-only status. Non-security metadata (license/dependencies/engines)
    // is intentionally excluded since it can legitimately shift across
    // lockfile regenerations without affecting the security pin.
    expect(lockfile.packages['node_modules/brace-expansion']).toMatchObject({
      version: '5.0.8',
      resolved: 'https://registry.npmjs.org/brace-expansion/-/brace-expansion-5.0.8.tgz',
      integrity:
        'sha512-JZyDyq3D4AUifKTPOB7DELf6XsB3WdPuNxCtob1vFXPsSXhdAiHBWJ/tJ8HAc9aH84BK+5JFZLNkJKx3G9kzQg==',
      dev: true,
    });
  });

  it('publishes canonical MIT license files and workspace metadata', async () => {
    const [license, notice, rootPackage, corePackage, lockfile] = await Promise.all([
      read('LICENSE'),
      read('NOTICE'),
      read('package.json').then(JSON.parse),
      read('packages/core/package.json').then(JSON.parse),
      read('package-lock.json').then(JSON.parse),
    ]);

    expect(await exists('LICENSE.TXT')).toBe(false);
    expect(license).toMatch(/^MIT License\r?\n\r?\nCopyright \(c\) Microsoft Corporation\./);
    expect(license).not.toMatch(/^ConfigForge/);
    expect(notice).toContain('Copyright (c) Microsoft Corporation.');
    expect(notice).toContain('See LICENSE at the repo root.');
    expect(rootPackage.license).toBe('MIT');
    expect(corePackage.license).toBe('MIT');
    expect(lockfile.packages[''].license).toBe('MIT');
    expect(lockfile.packages['packages/core'].license).toBe('MIT');
  });

  it('keeps privacy disclosures consistent across ConfigForge and oscfg', async () => {
    const privacy = await read('PRIVACY.md');

    expect(privacy).toContain('ConfigForge sends no product telemetry');
    expect(privacy).toContain('contacts GitHub Releases shortly after startup');
    expect(privacy).toContain('oscfg` may display a notice');
    expect(privacy).toContain('required diagnostic data');
    expect(privacy).not.toContain('The software may collect information about you');
    expect(privacy).not.toContain('Your use of the software operates as your consent');
  });

  it('runs the public-asset guard in packaging and release paths', async () => {
    const [desktopPackage, release, macRelease, prCheck] = await Promise.all([
      read('apps/desktop/package.json').then(JSON.parse),
      read('.github/workflows/release.yml'),
      read('.github/workflows/release-mac.yml'),
      read('.github/workflows/pr-check.yml'),
    ]);

    for (const script of ['dist', 'dist:win', 'dist:linux']) {
      expect(desktopPackage.scripts[script]).toContain('npm run verify:public-assets');
      expect(desktopPackage.scripts[script].indexOf('verify:public-assets')).toBeLessThan(
        desktopPackage.scripts[script].indexOf('electron-builder'),
      );
    }
    const releaseGuard = 'node scripts/verify-public-package-assets.mjs';
    const macReleaseGuard =
      'node .release-policy/scripts/verify-public-package-assets.mjs --root .';
    expect(release.indexOf(releaseGuard)).toBeGreaterThanOrEqual(0);
    expect(release.indexOf(releaseGuard)).toBeLessThan(
      release.indexOf('- name: Build Windows installers'),
    );
    expect(macRelease.indexOf(macReleaseGuard)).toBeGreaterThanOrEqual(0);
    expect(macRelease.indexOf(macReleaseGuard)).toBeLessThan(
      macRelease.indexOf('- name: Build macOS .dmg'),
    );
    expect(prCheck).toContain('node scripts/verify-public-package-assets.mjs');
    expect(prCheck).toContain('node --test scripts/verify-public-package-assets.node-test.mjs');
  });

  it('runs PR checks automatically for both active branches', async () => {
    const workflow = await read('.github/workflows/pr-check.yml');
    expect(workflow).toMatch(/pull_request:\s*\n\s+branches: \[main, mac-author-build\]/m);
    expect(workflow).toMatch(/push:\s*\n\s+branches: \[main, mac-author-build\]/m);
    expect(workflow).toContain('workflow_dispatch:');
  });

  it('publishes ownership, support, and contribution metadata', async () => {
    const [
      codeowners,
      agents,
      contributing,
      readme,
      security,
      support,
      bugForm,
      featureForm,
      issueConfig,
      prTemplate,
    ] = await Promise.all([
      read('.github/CODEOWNERS'),
      read('AGENTS.md'),
      read('CONTRIBUTING.md'),
      read('README.md'),
      read('SECURITY.md'),
      read('SUPPORT.md'),
      read('.github/ISSUE_TEMPLATE/bug.yml'),
      read('.github/ISSUE_TEMPLATE/feature.yml'),
      read('.github/ISSUE_TEMPLATE/config.yml'),
      read('.github/pull_request_template.md'),
    ]);

    expect(codeowners).toContain('* @ABMFST');
    expect(agents).toContain('Community-maintained by [@ABMFST]');
    expect(agents).toContain('Do not cross-merge `main` and `mac-author-build`');
    expect(contributing).toContain('the current repository maintainer');
    expect(contributing).toMatch(/Do not merge the two active branches into each\s+other/);
    expect(contributing).toContain('creates immutable release tags and draft');
    expect(support).toContain('The current repository maintainer is');
    expect(readme).toContain('for ownership, active-branch, review, release, and cherry-pick guidance');
    expect(security).toContain('v0.3.98');
    expect(security).toContain('mac-v0.3.98-author.1');
    expect(security).toContain('Microsoft Security Response Center');
    expect(security).toContain('Microsoft OSConfig project');
    expect(support).toContain('best-effort basis');
    expect(support).not.toMatch(/mailto:|@microsoft\.com/i);
    expect(bugForm).toContain('name: Bug report');
    expect(featureForm).toContain('name: Feature request');
    expect(issueConfig).toContain('blank_issues_enabled: false');
    expect(issueConfig).toContain('msrc.microsoft.com/report/vulnerability/new');
    expect(prTemplate).toContain('## Security and public readiness');
    expect(prTemplate).toContain('## Flavor and release flow');
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
