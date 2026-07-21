// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const SERVER_2025_BASELINES = [
  'ws2025-member-server.osc.yaml',
  'ws2025-domain-controller.osc.yaml',
  'ws2025-workgroup-member.osc.yaml',
] as const;

describe('Server 2025 ImpersonateClient compatibility', () => {
  it.each(SERVER_2025_BASELINES)(
    'uses the current string-backed UserRights representation in %s',
    async (filename) => {
      const source = await readFile(
        path.join(__dirname, '..', '..', '..', '..', 'public', '_baselines', filename),
        'utf8',
      );
      const document = yaml.load(source) as {
        resources?: Array<{
          name?: string;
          properties?: {
            resource?: { properties?: Record<string, unknown> };
            schema?: Record<string, unknown>;
          };
        }>;
      };
      const rule = document.resources?.find((resource) => resource.name === 'ImpersonateClient');
      const properties = rule?.properties?.resource?.properties;

      expect(properties).toEqual({
        path: './Vendor/MSFT/Policy/Config/UserRights/ImpersonateClient',
        type: 'string',
        value: '*S-1-5-32-544,*S-1-5-6,*S-1-5-19,*S-1-5-20',
      });
      expect(rule?.properties?.schema).toEqual({
        items: {
          enum: ['*S-1-5-32-544', '*S-1-5-6', '*S-1-5-19', '*S-1-5-20'],
        },
      });
    },
  );
});
