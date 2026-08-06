// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(here, 'new-machine-configuration-package.ps1');

describe('Machine Configuration package compatibility helper', () => {
  it('patches both copies of the Microsoft.OSConfig Set wrapper', async () => {
    const script = await readFile(scriptPath, 'utf8');

    expect(script).toContain(
      'Modules\\Microsoft.OSConfig\\classes\\OSConfig.ps1',
    );
    expect(script).toContain(
      'Modules\\Microsoft.OSConfig\\Microsoft.OSConfig.psm1',
    );
    expect(script).toContain(
      '(ConvertTo-Json -InputObject $ResourceProperties -Compress -Depth 32)',
    );
    expect(script).toContain(
      "patch = 'Microsoft.OSConfig.SetJsonSerialization'",
    );
  });

  it('fails closed when the wrapper shape is unknown', async () => {
    const script = await readFile(scriptPath, 'utf8');

    expect(script).toContain(
      'Unsupported Microsoft.OSConfig Set wrapper',
    );
    expect(script).toContain(
      'vulnerable=$vulnerableCount fixed=$fixedCount',
    );
  });
});
