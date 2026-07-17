// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure handler for the audit-pack route.
 *
 *   buildAuditPackArtifact({ id, format, against?, disposition? })
 *     → { filename, contentType, body }
 *
 * `body` is `string` for Markdown and `Uint8Array` for PDF. The two
 * hosts handle this differently:
 *
 *   - Next.js wraps it into a NextResponse with Content-Type +
 *     Content-Disposition headers.
 *   - Electron writes it to disk via dialog.showSaveDialog, OR streams
 *     it through the `cfs-blob://audit-pack/<id>` protocol when used
 *     as an iframe preview.
 *
 * The PDF path generates fully in-memory (pdfkit's stream is collected
 * to a Buffer). For very large audit-packs the streaming path lives in
 * the cfs-blob:// protocol implementation; this function returns the
 * concatenated bytes for simplicity + portability.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import {
  getRegistration,
  getRegistrationSource,
  sanitizeNamespace,
  type ManifestRegistration,
} from '../oscfg';
import { getHistory } from '../history';
import { computeCompliance, type ComplianceReport } from '../cis/compliance';
import {
  buildAuditPack,
  type AuditPackInput,
  type HistoryEntryWithAuthor,
  type ProvenanceBundle,
} from '../audit-pack';
import { tryLoadRationale } from '../audit-pack/rationale-loader';
import { buildAuditPackMarkdown } from '../audit-pack/markdown';
import { resolvePublicAsset } from '../runtime/paths';
import {
  readAuditResultForRegistration,
  type PersistedAuditResult,
} from '../manifest/audit-results-store';
import { _getBaselineCatalog } from './library';
import { HandlerError } from './errors';

export type AuditPackFormat = 'pdf' | 'markdown';

export interface AuditPackRequest {
  id: string;
  format?: AuditPackFormat;
  against?: string | null;
  disposition?: 'attachment' | 'inline';
}

export interface AuditPackArtifact {
  filename: string;
  contentType: string;
  /** Markdown body (string) or PDF body (Uint8Array). */
  body: string | Uint8Array;
  /** RFC 6266 Content-Disposition value (host wraps as needed). */
  contentDisposition: string;
}

function dateStamp(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function sanitizeFilename(name: string): string {
  // Strip path separators + control chars; cap at 96 (matches manifest naming).
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').slice(0, 96) || 'manifest';
}

/** RFC 6266 — emits both `filename=` (ASCII) and `filename*=UTF-8''…`. */
export function contentDisposition(
  filename: string,
  type: 'attachment' | 'inline' = 'attachment',
): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_');
  const utf8 = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  const quoted = ascii.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `${type}; filename="${quoted}"; filename*=UTF-8''${utf8}`;
}

async function tryLoadCompliance(
  namespace: string,
  against: string | null | undefined,
): Promise<ComplianceReport | undefined> {
  if (!against) return undefined;
  try {
    const catalog = _getBaselineCatalog();
    const entry = catalog.find((b) => b.id === against) as
      | (typeof catalog)[number] & { category?: string; manifestUrl?: string }
      | undefined;
    if (
      !entry ||
      entry.category !== 'cis-benchmark' ||
      entry.source !== 'local' ||
      !entry.manifestUrl
    ) {
      return undefined;
    }
    const publicRoot = resolvePublicAsset('');
    const requested = resolvePublicAsset(entry.manifestUrl);
    if (requested !== publicRoot && !requested.startsWith(publicRoot + path.sep)) {
      return undefined;
    }
    const userYaml = await getRegistrationSource(namespace);
    if (!userYaml) return undefined;
    const cisYaml = await readFile(requested, 'utf-8');
    const userDoc = yaml.load(userYaml) as { resources?: unknown };
    const cisDoc = yaml.load(cisYaml) as { resources?: unknown };
    return await computeCompliance(userDoc, cisDoc);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[audit-pack] compliance load failed:', err);
    return undefined;
  }
}

async function tryLoadProvenance(_namespace: string): Promise<ProvenanceBundle | undefined> {
  // No on-disk provenance store yet — see route.ts comment for the
  // rationale and the work needed to wire one up.
  return undefined;
}

async function tryLoadDeviceAudit(
  namespace: string,
  registration: ManifestRegistration,
): Promise<PersistedAuditResult | undefined> {
  // v0.1.6: load the cached `~/.configforge/audit-results/<ns>.json`
  // written by deploy.ts after every audit / enforce run. This is the
  // user's actual most-recent device-side compliance state — distinct
  // from the on-demand CIS-vs-user comparison in `tryLoadCompliance`.
  // Returns undefined when no audit has ever been run for this
  // namespace, so the new Device Audit section is omitted gracefully.
  try {
    return (
      (await readAuditResultForRegistration(namespace, {
        modifiedAt: registration.modifiedAt ?? registration.registeredAt,
        revision: registration.revision,
      })) ?? undefined
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[audit-pack] device audit load failed:', err);
    return undefined;
  }
}

async function loadAuditPackInput(
  namespace: string,
  registration: ManifestRegistration,
  against: string | null | undefined,
): Promise<AuditPackInput> {
  const [history, complianceReport, rationale, provenance, deviceAudit] = await Promise.all([
    getHistory(namespace).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[audit-pack] history load failed:', err);
      return [] as HistoryEntryWithAuthor[];
    }),
    tryLoadCompliance(namespace, against),
    tryLoadRationale(namespace),
    tryLoadProvenance(namespace),
    tryLoadDeviceAudit(namespace, registration),
  ]);
  return {
    manifest: registration,
    history: history as HistoryEntryWithAuthor[],
    rationale,
    complianceReport,
    provenance,
    deviceAudit,
  };
}

/**
 * Concatenate a pdfkit Readable stream into a single Buffer. pdfkit's
 * end-of-stream is signalled via the Readable's 'end' event.
 */
async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    stream.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', (err) => reject(err));
  });
}

export async function buildAuditPackArtifact(
  req: AuditPackRequest,
): Promise<AuditPackArtifact> {
  if (!req || typeof req.id !== 'string' || !req.id) {
    throw new HandlerError(400, 'Manifest id is required');
  }
  let displayName: string;
  try {
    displayName = decodeURIComponent(req.id);
  } catch {
    displayName = req.id;
  }
  const namespace = sanitizeNamespace(displayName);
  const format: AuditPackFormat = req.format ?? 'pdf';
  if (format !== 'pdf' && format !== 'markdown') {
    throw new HandlerError(400, "format must be one of: 'pdf', 'markdown'.");
  }
  const disposition: 'inline' | 'attachment' =
    req.disposition === 'inline' ? 'inline' : 'attachment';

  const registration = await getRegistration(namespace);
  if (!registration) {
    throw new HandlerError(404, `Manifest "${displayName}" is not registered.`);
  }
  const input = await loadAuditPackInput(namespace, registration, req.against);

  const filename = `${sanitizeFilename(namespace)}-audit-pack-${dateStamp(new Date())}.${
    format === 'pdf' ? 'pdf' : 'md'
  }`;

  if (format === 'markdown') {
    const md = buildAuditPackMarkdown(input);
    return {
      filename,
      contentType: 'text/markdown; charset=utf-8',
      body: md,
      contentDisposition: contentDisposition(filename, disposition),
    };
  }

  const pdfStream = buildAuditPack(input) as NodeJS.ReadableStream;
  const buffer = await streamToBuffer(pdfStream);
  return {
    filename,
    contentType: 'application/pdf',
    body: new Uint8Array(buffer),
    contentDisposition: contentDisposition(filename, disposition),
  };
}
