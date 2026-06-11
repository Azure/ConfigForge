// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure handler for `cfs:baseline-csv:fetch` (GET /api/baseline-csv?url=…).
 *
 * Proxies a CSV download from `raw.githubusercontent.com/microsoft/osconfig/`.
 * The host is allowlisted to prevent the renderer from using this
 * channel as a generic HTTP proxy.
 *
 * Returns the raw CSV text plus a content type so callers can either
 * pipe it to a file via a download dialog or parse it inline.
 */
import { HandlerError } from './errors';

const ALLOWED_HOST = 'raw.githubusercontent.com';
const ALLOWED_PATH_PREFIX = '/microsoft/osconfig/';
// Same cap used by handlers/manifests.ts when fetching remote manifests.
// Without this bound, a multi-GB response (or a server that streams
// indefinitely) buffers entirely into the main process and OOMs Electron.
const MAX_REMOTE_BYTES = 10 * 1024 * 1024;

export interface BaselineCsvRequest {
  url: string;
}

export interface BaselineCsvResult {
  contentType: string;
  text: string;
}

export async function fetchBaselineCsv(
  req: BaselineCsvRequest,
): Promise<BaselineCsvResult> {
  if (!req || typeof req !== 'object' || typeof req.url !== 'string' || !req.url) {
    throw new HandlerError(400, 'Missing "url" parameter');
  }

  let parsed: URL;
  try {
    parsed = new URL(req.url);
  } catch {
    throw new HandlerError(400, 'Invalid URL');
  }

  if (parsed.hostname !== ALLOWED_HOST || !parsed.pathname.startsWith(ALLOWED_PATH_PREFIX)) {
    throw new HandlerError(
      403,
      'URL not allowed — must be from the microsoft/osconfig repo',
    );
  }

  let res: Response;
  try {
    res = await fetch(req.url, {
      headers: { Accept: 'text/csv,text/plain' },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Fetch failed';
    throw new HandlerError(502, message);
  }
  if (!res.ok) {
    throw new HandlerError(res.status, `GitHub returned ${res.status}`);
  }
  // Reject up-front when the server advertises an oversize body, then
  // re-check after read in case Content-Length was missing or chunked.
  const contentLength = res.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_REMOTE_BYTES) {
    throw new HandlerError(
      413,
      `Remote CSV too large (${contentLength} bytes); limit is 10 MB.`,
    );
  }
  const text = await res.text();
  if (text.length > MAX_REMOTE_BYTES) {
    throw new HandlerError(
      413,
      `Remote CSV too large (${text.length} bytes); limit is 10 MB.`,
    );
  }
  return {
    contentType: 'text/csv; charset=utf-8',
    text,
  };
}
