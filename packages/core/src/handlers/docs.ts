// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure handler for `cfs:docs:get` (GET /api/docs?name=…).
 *
 * POST mode (manual content) lives in `docs-write.ts` for Phase 4 pass B.
 */
import {
  getRegistrationSource,
  getResources,
  resourcesToYaml,
  sanitizeNamespace,
} from '../oscfg';
import { generateManifestDoc } from '../doc-generator';
import { HandlerError } from './errors';

export async function getDocsForManifest(name: string): Promise<{
  markdown: string;
  filename: string;
}> {
  if (!name) throw new HandlerError(400, 'name is required');
  const namespace = sanitizeNamespace(name);
  let yamlText = await getRegistrationSource(namespace);
  if (!yamlText) {
    const r = await getResources({ namespace });
    if (!r.success) throw new HandlerError(500, r.error ?? 'Could not read resources');
    yamlText = resourcesToYaml(namespace, r.data ?? []);
  }
  const markdown = generateManifestDoc(yamlText, name);
  return { markdown, filename: `${name}.md` };
}
