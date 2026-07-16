// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { XccdfDiscovery } from '../cis/xccdf-parser';
import { recognizedXccdfBundleFilenames } from './cis-status';

describe('recognizedXccdfBundleFilenames', () => {
  it('recognizes the primary OVAL and standard SCAP sidecars for a detected XCCDF', () => {
    const prefix =
      'CIS_Azure_Compute_Microsoft_Windows_Server_2022_Benchmark_v1.0.0';
    const discovery: XccdfDiscovery = {
      filename: `${prefix}-xccdf.xml`,
      xccdfPath: join('catalogs', `${prefix}-xccdf.xml`),
      ovalPath: join('catalogs', `${prefix}-oval.xml`),
      platform: 'windows',
      product: 'Windows Server',
      version: '2022',
      title: 'CIS Azure Compute Microsoft Windows Server 2022 Benchmark',
    };

    expect(recognizedXccdfBundleFilenames([discovery])).toEqual(
      new Set([
        `${prefix}-xccdf.xml`,
        `${prefix}-oval.xml`,
        `${prefix}-cpe-oval.xml`,
        `${prefix}-cpe-dictionary.xml`,
        `${prefix}-ocil.xml`,
      ]),
    );
  });

  it('does not recognize unrelated files from another benchmark prefix', () => {
    const discovery: XccdfDiscovery = {
      filename: 'CIS_Server_2022-xccdf.xml',
      xccdfPath: join('catalogs', 'CIS_Server_2022-xccdf.xml'),
      ovalPath: null,
      platform: 'windows',
      product: 'Windows Server',
      version: '2022',
      title: 'CIS Server 2022',
    };

    const recognized = recognizedXccdfBundleFilenames([discovery]);
    expect(recognized.has('CIS_Server_2025-cpe-oval.xml')).toBe(false);
    expect(recognized.has('notes.xml')).toBe(false);
  });
});
