// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure handler for `cfs:docs:generate` (POST /api/docs).
 *
 * Generates Markdown documentation from arbitrary manifest content
 * provided by the caller. Used when previewing docs for an unsaved
 * manifest. The GET path (registered manifest by name) lives in
 * `docs.ts`.
 */
import { generateManifestDoc } from '../doc-generator';
import { HandlerError } from './errors';

export interface GenerateDocsRequest {
  name: string;
  content: string;
}

export function generateDocsFromContent(req: GenerateDocsRequest): {
  markdown: string;
  filename: string;
} {
  if (!req || typeof req !== 'object') {
    throw new HandlerError(400, 'Body must be a JSON object');
  }
  if (typeof req.name !== 'string' || !req.name) {
    throw new HandlerError(400, 'name is required');
  }
  if (typeof req.content !== 'string' || !req.content) {
    throw new HandlerError(400, 'content is required');
  }
  const markdown = generateManifestDoc(req.content, req.name);
  return { markdown, filename: `${req.name}.md` };
}
