// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { spawnSync } from 'child_process';
import type { SystemInfo } from './types';

/**
 * Collect Windows system info via a single PowerShell probe. PowerShell is
 * kept here (per design decision) because:
 *   - WindowsIdentity admin detection is cleaner than net session parsing
 *   - Registry ProductName read is trivial
 *   - Kept isolated from OSConfig logic (which now uses oscfg)
 */
export async function getWindowsSystemInfo(): Promise<SystemInfo> {
  const script = [
    `$ErrorActionPreference = 'SilentlyContinue'`,
    `$identity  = [Security.Principal.WindowsIdentity]::GetCurrent()`,
    `$principal = New-Object Security.Principal.WindowsPrincipal($identity)`,
    `$isAdmin   = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)`,
    `$product   = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion').ProductName`,
    `$os        = [System.Environment]::OSVersion.VersionString`,
    `@{ isAdmin = [bool]$isAdmin; serverType = $product; osVersion = $os } | ConvertTo-Json -Compress`,
  ].join('\n');

  const shell = getPowerShellExe();
  const r = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    timeout: 10_000,
    encoding: 'utf-8',
  });

  if (r.status !== 0 || !r.stdout) {
    return {
      platform: 'win32',
      isAdmin: false,
      serverType: 'Unknown Windows',
      osVersion: '',
    };
  }

  try {
    const parsed = JSON.parse(r.stdout.trim()) as {
      isAdmin: boolean;
      serverType: string;
      osVersion: string;
    };
    return {
      platform: 'win32',
      isAdmin: !!parsed.isAdmin,
      serverType: parsed.serverType || 'Unknown Windows',
      osVersion: parsed.osVersion || '',
    };
  } catch {
    return {
      platform: 'win32',
      isAdmin: false,
      serverType: 'Unknown Windows',
      osVersion: '',
    };
  }
}

let _resolvedShell: string | null = null;
function getPowerShellExe(): string {
  if (_resolvedShell) return _resolvedShell;
  try {
    const r = spawnSync('pwsh', ['-NoProfile', '-Command', 'echo ok'], {
      windowsHide: true,
      timeout: 5000,
      encoding: 'utf-8',
    });
    if (r.status === 0) {
      _resolvedShell = 'pwsh';
      return _resolvedShell;
    }
  } catch {
    /* ignore */
  }
  _resolvedShell = 'powershell';
  return _resolvedShell;
}
