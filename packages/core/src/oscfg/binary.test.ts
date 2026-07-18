// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Tests for the oscfg binary resolver.
 *
 * v0.2.0+ covers the bring-your-own-CLI lookup chain:
 *   1. OSCFG_BIN override
 *   2. Bundled (resources/oscfg/<platform>/)
 *   3. Well-known install locations (winget MSIX alias, WinGet Links,
 *      Program Files, Linux /usr or /opt or ~/.local/bin)
 *   4. PATH (where / which)
 *   5. (Windows) Get-AppxPackage Microsoft.OSConfig fallback
 *
 * The MSIX fallback exists because winget installs Microsoft.OSConfig
 * as an MSIX package and the App Execution Alias does not always
 * propagate to PATH for already-running Electron processes. The lookup
 * lets ConfigForge find the CLI even when PATH is stale.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted state buckets that the mocks read from. Tests set these
// before calling resolveOscfgBinary().
const state = vi.hoisted(() => ({
  existsSet: new Set<string>(),
  spawnImpl: null as null | ((cmd: string, args: readonly string[]) => {
    status: number;
    stdout: string;
    stderr: string;
  }),
}));

vi.mock('child_process', () => ({
  spawnSync: (cmd: string, args: readonly string[] = []) => {
    const r = state.spawnImpl?.(cmd, args) ?? { status: 1, stdout: '', stderr: '' };
    return {
      pid: 1,
      output: ['', r.stdout, r.stderr],
      stdout: r.stdout,
      stderr: r.stderr,
      status: r.status,
      signal: null,
    };
  },
}));

vi.mock('fs', () => ({
  existsSync: (p: string) => state.existsSet.has(String(p)),
}));

vi.mock('../runtime/paths', () => ({
  resolveOscfgBinaryDir: (sub: string) => `/fake-resources/oscfg/${sub}`,
}));

async function loadModule() {
  vi.resetModules();
  return await import('./binary');
}

const originalPlatform = process.platform;
const originalEnv = { ...process.env };

function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

beforeEach(() => {
  state.existsSet = new Set();
  state.spawnImpl = null;
  // Reset env to a known minimal state per test
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, originalEnv);
  delete process.env.OSCFG_BIN;
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
});

describe('wellKnownInstallPaths', () => {
  it('on Windows, includes the WindowsApps App Execution Alias path', async () => {
    setPlatform('win32');
    process.env.LOCALAPPDATA = 'C:\\Users\\amir\\AppData\\Local';
    const mod = await loadModule();
    const paths = mod._wellKnownInstallPathsForTest();
    expect(
      paths.some(
        (p) => p.includes('Microsoft') && p.includes('WindowsApps') && p.endsWith('oscfg.exe'),
      ),
    ).toBe(true);
  });

  it('on Windows, includes the WinGet user-scope Links shim path', async () => {
    setPlatform('win32');
    process.env.LOCALAPPDATA = 'C:\\Users\\amir\\AppData\\Local';
    const mod = await loadModule();
    const paths = mod._wellKnownInstallPathsForTest();
    expect(
      paths.some((p) => p.includes('WinGet') && p.includes('Links') && p.endsWith('oscfg.exe')),
    ).toBe(true);
  });

  it('on Windows, includes Program Files OSConfig paths when set', async () => {
    setPlatform('win32');
    process.env.ProgramFiles = 'C:\\Program Files';
    process.env['ProgramFiles(x86)'] = 'C:\\Program Files (x86)';
    const mod = await loadModule();
    const paths = mod._wellKnownInstallPathsForTest();
    expect(paths).toContain('C:\\Program Files\\OSConfig\\oscfg.exe');
    expect(paths).toContain('C:\\Program Files\\Microsoft\\OSConfig\\oscfg.exe');
    expect(paths).toContain('C:\\Program Files (x86)\\OSConfig\\oscfg.exe');
  });

  it('on Linux, includes /usr/bin, /usr/local/bin, /opt and ~/.local/bin', async () => {
    setPlatform('linux');
    process.env.HOME = '/home/amir';
    const mod = await loadModule();
    const paths = mod._wellKnownInstallPathsForTest();
    expect(paths).toContain('/usr/local/bin/oscfg');
    expect(paths).toContain('/usr/bin/oscfg');
    expect(paths).toContain('/opt/osconfig/bin/oscfg');
    expect(paths).toContain('/opt/osconfig/oscfg');
    expect(paths).toContain('/home/amir/.local/bin/oscfg');
  });

  it('on Linux, omits HOME-derived path when HOME is unset', async () => {
    setPlatform('linux');
    delete process.env.HOME;
    const mod = await loadModule();
    const paths = mod._wellKnownInstallPathsForTest();
    expect(paths.find((p) => p.includes('.local'))).toBeUndefined();
  });
});

describe('resolveOscfgBinary: well-known install path discovery', () => {
  it('on Windows with no PATH match, finds the WindowsApps alias and tags source as "installed"', async () => {
    setPlatform('win32');
    process.env.LOCALAPPDATA = 'C:\\Users\\amir\\AppData\\Local';
    const aliasPath = 'C:\\Users\\amir\\AppData\\Local\\Microsoft\\WindowsApps\\oscfg.exe';

    state.existsSet.add(aliasPath);
    state.spawnImpl = (cmd) => {
      if (cmd === aliasPath) {
        return { status: 0, stdout: 'oscfg 1.3.10-preview13\n', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: '' };
    };

    const mod = await loadModule();
    const info = mod.resolveOscfgBinary();
    expect(info.path).toBe(aliasPath);
    expect(info.source).toBe('installed');
    expect(info.version).toBe('oscfg 1.3.10-preview13');
  });

  it('on Linux with no PATH match, finds /usr/bin/oscfg and tags source as "installed"', async () => {
    setPlatform('linux');
    const usrPath = '/usr/bin/oscfg';
    state.existsSet.add(usrPath);
    state.spawnImpl = (cmd) => {
      if (cmd === usrPath) {
        return { status: 0, stdout: 'oscfg 1.3.10\n', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: '' };
    };

    const mod = await loadModule();
    const info = mod.resolveOscfgBinary();
    expect(info.path).toBe(usrPath);
    expect(info.source).toBe('installed');
  });

  it('does not spawn probes for missing non-alias Windows install paths', async () => {
    setPlatform('win32');
    process.env.LOCALAPPDATA = 'C:\\Users\\amir\\AppData\\Local';
    process.env.ProgramFiles = 'C:\\Program Files';
    const commands: string[] = [];
    state.spawnImpl = (cmd) => {
      commands.push(cmd);
      return { status: 1, stdout: '', stderr: '' };
    };

    const mod = await loadModule();
    expect(() => mod.resolveOscfgBinary()).toThrow(/OSConfig CLI not found/);

    expect(commands).toContain(
      'C:\\Users\\amir\\AppData\\Local\\Microsoft\\WindowsApps\\oscfg.exe',
    );
    expect(commands).not.toContain(
      'C:\\Users\\amir\\AppData\\Local\\Microsoft\\WinGet\\Links\\oscfg.exe',
    );
    expect(commands).not.toContain('C:\\Program Files\\OSConfig\\oscfg.exe');
  });
});

describe('resolveOscfgBinary: MSIX fallback (Windows only)', () => {
  it('falls back to Get-AppxPackage when no other lookup wins and tags source as "msix"', async () => {
    setPlatform('win32');
    // Clear env so no well-known paths are produced
    delete process.env.LOCALAPPDATA;
    delete process.env.ProgramFiles;
    delete process.env['ProgramFiles(x86)'];

    const msixDir = 'C:\\Program Files\\WindowsApps\\Microsoft.OSConfig_1.3.10.13_x64__8wekyb3d8bbwe';
    const msixExe = `${msixDir}\\oscfg.exe`;

    state.existsSet.add(msixExe);
    state.spawnImpl = (cmd, args) => {
      // 1. Initial sweep through candidatePaths: nothing exists.
      // 2. PATH probe ("where oscfg.exe") returns nothing.
      if (cmd === 'where') {
        return { status: 1, stdout: '', stderr: 'INFO: Could not find files.\n' };
      }
      // 3. Get-AppxPackage probe.
      if (cmd === 'powershell.exe' && args.some((a: string) => a.includes('Get-AppxPackage'))) {
        return { status: 0, stdout: `${msixDir}\n`, stderr: '' };
      }
      // 4. Version check on the MSIX exe.
      if (cmd === msixExe) {
        return { status: 0, stdout: 'oscfg 1.3.10-preview13\n', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: '' };
    };

    const mod = await loadModule();
    const info = mod.resolveOscfgBinary();
    expect(info.path).toBe(msixExe);
    expect(info.source).toBe('msix');
    expect(info.version).toBe('oscfg 1.3.10-preview13');
  });

  it('throws when none of the lookups succeed', async () => {
    setPlatform('win32');
    delete process.env.LOCALAPPDATA;
    delete process.env.ProgramFiles;
    delete process.env['ProgramFiles(x86)'];

    state.spawnImpl = () => ({ status: 1, stdout: '', stderr: '' });

    const mod = await loadModule();
    expect(() => mod.resolveOscfgBinary()).toThrow(/OSConfig CLI not found/);
  });
});

describe('resolveOscfgBinary: env override still wins', () => {
  it('OSCFG_BIN takes precedence over well-known install paths', async () => {
    setPlatform('win32');
    const overridePath = 'D:\\custom\\oscfg.exe';
    process.env.OSCFG_BIN = overridePath;
    process.env.LOCALAPPDATA = 'C:\\Users\\amir\\AppData\\Local';

    // Both the override AND the alias exist; override should be picked first.
    state.existsSet.add(overridePath);
    state.existsSet.add('C:\\Users\\amir\\AppData\\Local\\Microsoft\\WindowsApps\\oscfg.exe');
    state.spawnImpl = () => ({ status: 0, stdout: 'oscfg 1.3.10\n', stderr: '' });

    const mod = await loadModule();
    const info = mod.resolveOscfgBinary();
    expect(info.path).toBe(overridePath);
    expect(info.source).toBe('env');
  });
});
