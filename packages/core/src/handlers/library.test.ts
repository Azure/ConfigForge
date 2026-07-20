// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { csvToManifest } from './library';

describe('csvToManifest', () => {
  it('uses the shared OSConfig converter for catalog CSVs', () => {
    const output = csvToManifest(
      [
        'Name,Registry Key,Registry Value,Registry Value Type,Expected Value',
        'PasswordBackup,HKLM:\\SOFTWARE\\LAPS,BackupDirectory,REG_DWORD,Equals(1)',
      ].join('\n'),
    );
    const document = yaml.load(output) as {
      resources: Array<Record<string, unknown>>;
    };

    expect(document.resources[0]).toEqual(
      expect.objectContaining({
        name: 'PasswordBackup',
        type: 'Microsoft.OSConfig/Test',
      }),
    );
  });
});
