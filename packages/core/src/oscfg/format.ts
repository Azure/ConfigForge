// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import yaml from 'js-yaml';
import type { OscfgResource } from './types';

/**
 * Reconstruct an OSConfig manifest YAML from a list of resources using js-yaml.
 * Preferred over hand-rolled emission — handles multiline strings, unicode,
 * registry paths with backslashes, and nested objects correctly.
 *
 * Output shape matches what the app and OSConfig CLI expect:
 *   $schema: https://aka.ms/osc/schemas/prerelease/document.json
 *   name: <namespace>
 *   resources:
 *     - name: <name>
 *       type: <type>
 *       properties: { ... }
 *       compliance?: { ... }
 */
export function resourcesToYaml(
  namespace: string,
  resources: OscfgResource[],
): string {
  const doc: Record<string, unknown> = {
    $schema: 'https://aka.ms/osc/schemas/prerelease/document.json',
    name: namespace,
    resources: resources.map((r) => {
      const out: Record<string, unknown> = { name: r.name, type: r.type };
      if (r.properties && Object.keys(r.properties).length > 0) out.properties = r.properties;
      if (r.compliance) out.compliance = r.compliance;
      return out;
    }),
  };
  return (
    '# Reconstructed by ConfigForge from oscfg JSON output\n' +
    yaml.dump(doc, { lineWidth: 120, noRefs: true, quotingType: '"' })
  );
}

export function parseYamlDocument(text: string): Record<string, unknown> {
  const parsed = yaml.load(text);
  if (!parsed || typeof parsed !== 'object') return {};
  return parsed as Record<string, unknown>;
}
