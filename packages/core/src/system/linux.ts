// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { spawnSync } from 'child_process';
import { readFile } from 'fs/promises';
import type { SystemInfo } from './types';

/**
 * Collect Linux system info using native commands.
 */
export async function getLinuxSystemInfo(): Promise<SystemInfo> {
  const isAdmin = spawnSync('id', ['-u'], { encoding: 'utf-8', timeout: 3000 })
    .stdout?.trim() === '0';

  let serverType = 'Linux';
  try {
    const osRelease = await readFile('/etc/os-release', 'utf-8');
    const m = osRelease.match(/PRETTY_NAME="?([^"\n]+)"?/);
    if (m) serverType = m[1];
  } catch {
    /* no os-release */
  }

  const unameRes = spawnSync('uname', ['-r'], { encoding: 'utf-8', timeout: 3000 });
  const osVersion = unameRes.stdout ? `Linux ${unameRes.stdout.trim()}` : 'Linux';

  return { platform: 'linux', isAdmin, serverType, osVersion };
}
