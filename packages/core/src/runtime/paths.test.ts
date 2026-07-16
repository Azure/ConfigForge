// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { afterEach, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import {
  resolveOscfgBinaryDir,
  resolvePublicAsset,
  resolveTempDir,
  resolveUserDataDir,
  setPathStrategy,
  resetPathStrategy,
  _getActivePathStrategyForTests,
  type PathStrategy,
} from './paths';

const originalPublicRoot = process.env.CONFIGFORGE_PUBLIC_ROOT;
const originalTestMode = process.env.CONFIGFORGE_TEST_MODE;

afterEach(() => {
  resetPathStrategy();
  if (originalPublicRoot === undefined) {
    delete process.env.CONFIGFORGE_PUBLIC_ROOT;
  } else {
    process.env.CONFIGFORGE_PUBLIC_ROOT = originalPublicRoot;
  }
  if (originalTestMode === undefined) {
    delete process.env.CONFIGFORGE_TEST_MODE;
  } else {
    process.env.CONFIGFORGE_TEST_MODE = originalTestMode;
  }
});

describe('PathStrategy default', () => {
  it('resolveOscfgBinaryDir matches pre-Electron behavior (cwd-relative)', () => {
    const got = resolveOscfgBinaryDir('win32-x64');
    expect(got).toBe(path.join(process.cwd(), 'resources', 'oscfg', 'win32-x64'));
  });

  it('resolvePublicAsset strips leading slashes', () => {
    const a = resolvePublicAsset('/_baselines/x.yaml');
    const b = resolvePublicAsset('_baselines/x.yaml');
    const c = resolvePublicAsset('////_baselines/x.yaml');
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a).toBe(path.resolve(process.cwd(), 'public', '_baselines', 'x.yaml'));
  });

  it('uses CONFIGFORGE_PUBLIC_ROOT only in explicit test mode', () => {
    const isolatedRoot = path.join(os.tmpdir(), 'configforge-isolated-public-assets');
    process.env.CONFIGFORGE_PUBLIC_ROOT = isolatedRoot;
    process.env.CONFIGFORGE_TEST_MODE = '1';

    expect(resolvePublicAsset('/_baselines/cis/_data/catalog.json')).toBe(
      path.resolve(isolatedRoot, '_baselines', 'cis', '_data', 'catalog.json'),
    );

    delete process.env.CONFIGFORGE_PUBLIC_ROOT;
    expect(resolvePublicAsset('/_baselines/x.yaml')).toBe(
      path.resolve(process.cwd(), 'public', '_baselines', 'x.yaml'),
    );
  });

  it('ignores CONFIGFORGE_PUBLIC_ROOT outside test mode', () => {
    process.env.CONFIGFORGE_PUBLIC_ROOT = path.join(os.tmpdir(), 'untrusted-public-assets');
    delete process.env.CONFIGFORGE_TEST_MODE;
    expect(resolvePublicAsset('/_baselines/x.yaml')).toBe(
      path.resolve(process.cwd(), 'public', '_baselines', 'x.yaml'),
    );
  });

  it('resolveTempDir uses os.tmpdir()', () => {
    expect(resolveTempDir()).toBe(os.tmpdir());
  });

  it('resolveUserDataDir uses ~/.configforge', () => {
    expect(resolveUserDataDir()).toBe(path.join(os.homedir(), '.configforge'));
  });
});

describe('PathStrategy override', () => {
  it('setPathStrategy fully replaces the default for every accessor', () => {
    const stub: PathStrategy = {
      resolveOscfgBinaryDir: (sub) => `/elec/oscfg/${sub}`,
      resolvePublicAsset: (rel) => `/elec/public/${rel.replace(/^\/+/, '')}`,
      resolveTempDir: () => '/elec/temp',
      resolveUserDataDir: () => '/elec/userdata',
    };
    setPathStrategy(stub);

    expect(resolveOscfgBinaryDir('linux-x64')).toBe('/elec/oscfg/linux-x64');
    expect(resolvePublicAsset('/_baselines/x.yaml')).toBe('/elec/public/_baselines/x.yaml');
    expect(resolveTempDir()).toBe('/elec/temp');
    expect(resolveUserDataDir()).toBe('/elec/userdata');
  });

  it('resetPathStrategy restores the built-in default', () => {
    setPathStrategy({
      resolveOscfgBinaryDir: () => '/x',
      resolvePublicAsset: () => '/x',
      resolveTempDir: () => '/x',
      resolveUserDataDir: () => '/x',
    });
    expect(resolveTempDir()).toBe('/x');

    resetPathStrategy();
    expect(resolveTempDir()).toBe(os.tmpdir());
  });

  it('_getActivePathStrategyForTests returns whatever was last set', () => {
    const stub: PathStrategy = {
      resolveOscfgBinaryDir: () => '/a',
      resolvePublicAsset: () => '/b',
      resolveTempDir: () => '/c',
      resolveUserDataDir: () => '/d',
    };
    setPathStrategy(stub);
    expect(_getActivePathStrategyForTests()).toBe(stub);
  });

  it('overrides take effect on the next call (no caching)', () => {
    expect(resolveTempDir()).toBe(os.tmpdir());

    setPathStrategy({
      resolveOscfgBinaryDir: () => '/x',
      resolvePublicAsset: () => '/x',
      resolveTempDir: () => '/first',
      resolveUserDataDir: () => '/x',
    });
    expect(resolveTempDir()).toBe('/first');

    setPathStrategy({
      resolveOscfgBinaryDir: () => '/x',
      resolvePublicAsset: () => '/x',
      resolveTempDir: () => '/second',
      resolveUserDataDir: () => '/x',
    });
    expect(resolveTempDir()).toBe('/second');
  });
});
