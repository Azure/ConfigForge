// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Real `cfs-blob://` protocol handler — Phase 4-F.
 *
 * Replaces the Phase 2 spike. Routes:
 *
 *   cfs-blob://audit-pack/<manifest-id>?format=pdf|markdown
 *     Streams an audit-pack artifact for inline iframe preview.
 *
 *   cfs-blob://export/<manifest-name>?format=yaml|json|...
 *     Streams an export artifact for inline preview / display.
 *
 * Both call the same pure handlers in `@configforge/core/handlers`.
 * Errors flow back as plain HTTP-style responses so Chromium's PDF
 * viewer + iframe error UX behave naturally.
 *
 * Why a custom protocol instead of file:// or blob: ?
 *   See `apps/desktop/electron/protocol.ts` (Phase 2 decision doc).
 */
import { protocol } from 'electron';
import {
  buildAuditPackArtifact,
  contentDisposition,
  exportManifest,
  HandlerError,
  isHandlerError,
  type AuditPackFormat,
  type ExportFormat,
} from '@configforge/core/handlers';

function errorResponse(err: unknown): Response {
  let status = 500;
  let message = 'Unknown error';
  if (isHandlerError(err)) {
    status = err.status;
    message = err.message;
  } else if (err instanceof Error) {
    message = err.message;
  }
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function bodyToResponseBody(body: string | Uint8Array): BodyInit {
  return typeof body === 'string' ? body : body;
}

/**
 * v0.1.19 — defense-in-depth whitelist for path-segment values arriving
 * over the cfs-blob:// scheme. A renderer-side XSS or a maliciously
 * crafted import that plants a `<a href="cfs-blob://audit-pack/../../etc/passwd">`
 * link could otherwise feed unexpected strings to downstream handlers.
 * The actual handlers in @configforge/core treat these as keys/IDs (not
 * filesystem paths) so a traversal would not currently materialize a
 * file read, but bounding the surface here means a future regression
 * downstream can't suddenly become exploitable. Manifest names + IDs
 * in our system are constrained to alphanumerics, dash, underscore,
 * and dot — see core/types.ts validators — so this regex is consistent
 * with the existing schema.
 */
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._-]{1,256}$/;

function isSafePathSegment(value: string): boolean {
  return SAFE_PATH_SEGMENT.test(value);
}

async function handleAuditPackRequest(url: URL): Promise<Response> {
  const id = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!id) {
    return errorResponse(new HandlerError(400, 'audit-pack manifest id is required in path'));
  }
  if (!isSafePathSegment(id)) {
    return errorResponse(new HandlerError(400, 'audit-pack manifest id contains invalid characters'));
  }
  const formatParam = url.searchParams.get('format');
  const format: AuditPackFormat | undefined =
    formatParam === 'pdf' || formatParam === 'markdown' ? formatParam : undefined;
  const against = url.searchParams.get('against');
  // The cfs-blob:// path is for INLINE preview by definition.
  const artifact = await buildAuditPackArtifact({
    id,
    format: format ?? 'pdf',
    against,
    disposition: 'inline',
  });
  return new Response(bodyToResponseBody(artifact.body), {
    status: 200,
    headers: {
      'Content-Type': artifact.contentType,
      'Content-Disposition': artifact.contentDisposition,
      'Cache-Control': 'no-store',
    },
  });
}

async function handleExportRequest(url: URL): Promise<Response> {
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!name) {
    return errorResponse(new HandlerError(400, 'export name is required in path'));
  }
  if (!isSafePathSegment(name)) {
    return errorResponse(new HandlerError(400, 'export name contains invalid characters'));
  }
  const format = (url.searchParams.get('format') ?? 'yaml') as ExportFormat;
  const effectParam = url.searchParams.get('effect');
  const artifact = await exportManifest({
    name,
    format,
    effect:
      effectParam === 'AuditIfNotExists' || effectParam === 'DeployIfNotExists'
        ? effectParam
        : undefined,
  });
  return new Response(artifact.body, {
    status: 200,
    headers: {
      'Content-Type': artifact.contentType,
      // H2: route the filename through the same RFC 6266 helper that
      // audit-pack uses, so a name with `"`, `\r`, or `\n` (which can
      // come straight from decodeURIComponent) cannot inject header
      // bytes. The helper strips control chars, escapes quotes, and
      // emits both ASCII `filename=` and UTF-8 `filename*=` forms.
      'Content-Disposition': contentDisposition(artifact.filename, 'inline'),
      'Cache-Control': artifact.cacheable ? 'private, max-age=30' : 'no-store',
    },
  });
}

/**
 * Register the production `cfs-blob://` handler. Replaces the Phase 2
 * spike's hard-coded sample PDF route. Must be called AFTER
 * `app.whenReady()` and AFTER the path strategy is installed.
 */
export function registerCfsBlobProtocol(): void {
  protocol.handle('cfs-blob', async (request: GlobalRequest) => {
    try {
      const url = new URL(request.url);
      switch (url.hostname) {
        case 'audit-pack':
          return await handleAuditPackRequest(url);
        case 'export':
          return await handleExportRequest(url);
        default:
          return new Response(`unknown route: ${url.hostname}`, { status: 404 });
      }
    } catch (err) {
      return errorResponse(err);
    }
  });
}
