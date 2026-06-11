// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure handler for `cfs:export:get` (GET /api/export?name=…&format=…).
 *
 * Five formats supported:
 *
 *   yaml         — original registered source (lossless), or
 *                  reconstructed-from-CLI if no source is stored
 *   json         — canonical manifest JSON (round-trips through import)
 *   mof          — DSC-compatible MOF text
 *   excel        — flattened CSV of resource properties
 *   azurepolicy  — Azure Policy JSON wrapping the manifest
 *
 * Returns `{ filename, contentType, body }` where body is always a
 * string (the renderer handles UTF-8 encoding). Hosts decide between
 * inline display, dialog-based save, or download endpoint.
 */
import {
  getResources,
  getRegistrationSource,
  sanitizeNamespace,
  resourcesToYaml,
  parseYamlDocument,
} from '../oscfg';
import {
  exportToYaml,
  exportToJson,
  exportToMof,
  exportToExcel,
  exportToAzurePolicy,
} from '../import-export';
import { HandlerError } from './errors';

export type ExportFormat = 'yaml' | 'json' | 'mof' | 'excel' | 'azurepolicy';

const CONTENT_TYPES: Record<ExportFormat, string> = {
  yaml: 'application/x-yaml',
  json: 'application/json',
  mof: 'text/plain',
  excel: 'text/csv',
  azurepolicy: 'application/json',
};

const EXTENSIONS: Record<ExportFormat, string> = {
  yaml: '.osc.yaml',
  json: '.json',
  mof: '.mof',
  excel: '.csv',
  azurepolicy: '.policy.json',
};

export interface ExportRequest {
  name: string;
  format?: ExportFormat;
  /** AzurePolicy effect; ignored for other formats. */
  effect?: 'AuditIfNotExists' | 'DeployIfNotExists';
  /**
   * Optional OS override for `azurepolicy`. When omitted, the handler
   * auto-detects from the manifest's resource types. Useful when the
   * manifest is empty or all-placeholder and the caller knows which
   * platform to target.
   */
  osType?: 'Windows' | 'Linux';
}

export interface ExportArtifact {
  filename: string;
  contentType: string;
  body: string;
  /** Whether the response body is safe to cache briefly client-side. */
  cacheable: boolean;
}

/**
 * Determine the OS family targeted by a manifest's resources.
 *
 * A Guest Configuration package is single-OS by design (the OSConfig
 * agent is platform-specific; one MOF runs on one platform). So this
 * walks the resources once, classifies each by the well-known type
 * prefix, and returns the single matching OS — or throws if the
 * manifest somehow contains BOTH families (corrupted import; should
 * never happen in normal authoring).
 *
 * Returns `undefined` when the manifest has no OS-classifiable
 * resources (empty manifest, all wrappers, all placeholders). The
 * caller decides the fallback (typically 'Windows').
 */
function inferOsTypeFromResources(resources: unknown): 'Windows' | 'Linux' | undefined {
  let sawWindows = false;
  let sawLinux = false;

  const walk = (arr: unknown[]): void => {
    for (const raw of arr) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const type = typeof r.type === 'string' ? r.type : '';
      const props = (r.properties ?? {}) as Record<string, unknown>;

      // Unwrap Test/Group wrappers so the OS family classification
      // sees the actual target resource.
      if (type === 'Microsoft.OSConfig/Test') {
        if (props.resource && typeof props.resource === 'object') {
          walk([props.resource]);
        }
        continue;
      }
      if (type === 'Microsoft.OSConfig/Group' && Array.isArray(props.resources)) {
        walk(props.resources as unknown[]);
        continue;
      }

      if (type.startsWith('Microsoft.Windows/')) {
        sawWindows = true;
      } else if (type.startsWith('Microsoft.Linux/')) {
        sawLinux = true;
      } else if (type.startsWith('Microsoft.OSConfig/')) {
        // Linux-leaning OSConfig types. Everything else (BaselineRule,
        // Audit, etc.) is neutral and doesn't contribute to OS pick.
        const linuxOscTypes = new Set([
          'Microsoft.OSConfig/FileLine',
          'Microsoft.OSConfig/Sshd',
          'Microsoft.OSConfig/SshdConfig',
          'Microsoft.OSConfig/Package',
          'Microsoft.OSConfig/Firewall',
          'Microsoft.OSConfig/TimeZone',
          'Microsoft.OSConfig/Hostname',
          'Microsoft.OSConfig/EtcEnvironment',
          'Microsoft.OSConfig/Systemd',
        ]);
        if (linuxOscTypes.has(type)) sawLinux = true;
      }
    }
  };

  if (Array.isArray(resources)) walk(resources as unknown[]);

  if (sawWindows && sawLinux) {
    // Should be impossible — a GC MOF can only target one OS, and the
    // editor doesn't let users mix. If it happens, the manifest is
    // corrupted; surfacing it is much better than silently picking one
    // and shipping a broken policy.
    throw new HandlerError(
      400,
      'Manifest contains both Windows and Linux resources. A Guest Configuration package targets a single OS family — split the manifest into separate Windows and Linux baselines before exporting to Azure Policy.',
    );
  }
  if (sawWindows) return 'Windows';
  if (sawLinux) return 'Linux';
  return undefined;
}

/**
 * Find any unmapped placeholder-baseline resources (any resource of
 * type `Microsoft.OSConfig/BaselineRule`).
 *
 * These placeholders carry the rule identity (ruleId, displayName,
 * severity) but no implementation — the OSConfig agent cannot
 * evaluate them. If exported as Azure Policy:
 *
 *   - The MOF references an unknown type, so the agent skips every
 *     resource. The audit finishes with `complianceStatus: Compliant`
 *     and `resourceCount: 0`.
 *   - Azure Policy reports the policy as "Compliant" for every VM —
 *     because nothing was actually checked.
 *   - The user thinks their baseline is enforced. It isn't.
 *
 * Silent false-compliance is worse than no compliance. Callers should
 * refuse the export when this returns a non-empty list.
 */
function findPlaceholderBaselineResources(resources: unknown): string[] {
  const out: string[] = [];
  const walk = (arr: unknown[]): void => {
    for (const raw of arr) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const type = typeof r.type === 'string' ? r.type : '';
      const props = (r.properties ?? {}) as Record<string, unknown>;
      if (type === 'Microsoft.OSConfig/BaselineRule') {
        const name = typeof r.name === 'string' ? r.name : 'unnamed';
        out.push(name);
      }
      if (type === 'Microsoft.OSConfig/Test' && props.resource && typeof props.resource === 'object') {
        walk([props.resource]);
      } else if (type === 'Microsoft.OSConfig/Group' && Array.isArray(props.resources)) {
        walk(props.resources as unknown[]);
      }
    }
  };
  if (Array.isArray(resources)) walk(resources as unknown[]);
  return out;
}

/**
 * Pull source-of-truth metadata out of a manifest for use in the
 * generated Azure Policy. Looks at top-level `name`/`description`/
 * `version` on the parsed manifest (when present), and parses the
 * placeholder-baseline banner comment that the importer emits for
 * `settingsReference` imports so even round-tripped manifests carry
 * the original baseline identity into the policy. Returns whatever's
 * available; the policy generator fills in defaults for missing fields.
 */
function extractManifestMetadata(
  parsedManifest: Record<string, unknown> | null,
  sourceYaml: string | null,
): { displayName?: string; description?: string; version?: string; baselineId?: string } {
  const out: {
    displayName?: string;
    description?: string;
    version?: string;
    baselineId?: string;
  } = {};

  if (parsedManifest) {
    if (typeof parsedManifest.name === 'string' && parsedManifest.name.trim()) {
      out.displayName = parsedManifest.name;
    }
    if (typeof parsedManifest.description === 'string' && parsedManifest.description.trim()) {
      out.description = parsedManifest.description;
    }
    if (typeof parsedManifest.version === 'string' && parsedManifest.version.trim()) {
      out.version = parsedManifest.version;
    }
    const meta = parsedManifest.metadata as Record<string, unknown> | undefined;
    if (meta && typeof meta === 'object') {
      if (typeof meta.baselineId === 'string') out.baselineId = meta.baselineId;
      if (typeof meta.sourceVersion === 'string' && !out.version) out.version = meta.sourceVersion;
    }
  }

  if (sourceYaml) {
    // Parse the placeholder banner comment we emit on settingsReference
    // imports. Matches the format produced by
    // packages/core/src/handlers/import.ts → placeholderBaselineBanner.
    //
    //   # Imported from Azure Policy Guest Configuration baseline:
    //   #   <name>[ v<version>]
    //   #   <n> rules
    const bannerHeader = /^#\s*Imported from Azure Policy Guest Configuration baseline:\s*$/m;
    const bannerLine = /^#\s+([^\r\n]+?)(?:\s+v([^\s\r\n]+))?\s*$/;
    if (bannerHeader.test(sourceYaml)) {
      const idx = sourceYaml.search(bannerHeader);
      if (idx >= 0) {
        const tail = sourceYaml.slice(idx);
        const lines = tail.split(/\r?\n/).slice(1);
        for (const line of lines) {
          if (!/^#/.test(line)) break;
          const m = line.match(bannerLine);
          if (m && m[1] && !out.displayName) {
            out.displayName = m[1].trim();
            if (m[2]) out.version = m[2].trim();
            break;
          }
        }
      }
    }
  }

  return out;
}

function flattenResourcesToRows(resources: unknown): Array<{
  Name: string;
  Description: string;
  DataType: string;
  Default: string;
  Value: string;
  Compliance: string;
}> {
  const rows: Array<{
    Name: string;
    Description: string;
    DataType: string;
    Default: string;
    Value: string;
    Compliance: string;
  }> = [];
  if (!Array.isArray(resources)) return rows;

  const walk = (arr: unknown[], parentPath: string): void => {
    for (const raw of arr) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const name = typeof r.name === 'string' ? r.name : '';
      const type = typeof r.type === 'string' ? r.type : '';
      const props = (r.properties ?? {}) as Record<string, unknown>;
      const compliance =
        (r.compliance as Record<string, unknown> | undefined) ??
        (props.compliance as Record<string, unknown> | undefined);
      const complianceStr = compliance
        ? String(compliance.status ?? '') ||
          (compliance.equals !== undefined ? `equals:${String(compliance.equals)}` : '')
        : '';

      const path = parentPath ? `${parentPath}.${name}` : name;

      if (Array.isArray(props.resources)) {
        walk(props.resources as unknown[], path);
        continue;
      }
      if (props.resource && typeof props.resource === 'object') {
        walk([props.resource], path);
        continue;
      }

      const propEntries = Object.entries(props).filter(
        ([k]) => k !== 'resources' && k !== 'resource' && k !== 'compliance',
      );

      if (propEntries.length === 0) {
        rows.push({
          Name: path || name,
          Description: type,
          DataType: type,
          Default: '',
          Value: '',
          Compliance: complianceStr,
        });
        continue;
      }

      for (const [key, val] of propEntries) {
        const dataType =
          val === null
            ? 'null'
            : Array.isArray(val)
              ? 'array'
              : typeof val === 'object'
                ? 'object'
                : typeof val;
        const valueStr =
          typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val);
        rows.push({
          Name: `${path}.${key}`,
          Description: `${type} — ${key}`,
          DataType: dataType,
          Default: '',
          Value: valueStr,
          Compliance: complianceStr,
        });
      }
    }
  };

  walk(resources as unknown[], '');
  return rows;
}

const VALID_FORMATS: readonly ExportFormat[] = ['yaml', 'json', 'mof', 'excel', 'azurepolicy'];

export async function exportManifest(req: ExportRequest): Promise<ExportArtifact> {
  if (!req || typeof req.name !== 'string' || !req.name) {
    throw new HandlerError(400, 'name is required');
  }
  const format = (req.format ?? 'yaml') as ExportFormat;
  if (!VALID_FORMATS.includes(format)) {
    throw new HandlerError(
      400,
      `Invalid format: ${format}. Must be yaml, json, mof, excel, or azurepolicy`,
    );
  }

  const namespace = sanitizeNamespace(req.name);
  const filename = `${req.name}${EXTENSIONS[format]}`;

  const sourceYaml = await getRegistrationSource(namespace);

  let parsedManifest: Record<string, unknown> | null = null;
  if (sourceYaml) {
    try {
      const doc = parseYamlDocument(sourceYaml);
      if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
        parsedManifest = doc as Record<string, unknown>;
      }
    } catch {
      parsedManifest = null;
    }
  }

  const manifestResources: unknown[] = parsedManifest
    ? Array.isArray(parsedManifest.resources)
      ? (parsedManifest.resources as unknown[])
      : []
    : [];

  if (format === 'azurepolicy') {
    // Guard: refuse to export a placeholder-baseline manifest. The
    // resulting policy would silently report every VM as Compliant
    // because the OSConfig agent has no implementation for
    // Microsoft.OSConfig/BaselineRule and would skip every resource
    // without flagging an error.
    const placeholders = findPlaceholderBaselineResources(manifestResources);
    if (placeholders.length > 0) {
      const sample = placeholders.slice(0, 3).join(', ');
      const more = placeholders.length > 3 ? ` (+${placeholders.length - 3} more)` : '';
      throw new HandlerError(
        400,
        `Cannot export to Azure Policy: this manifest contains ${placeholders.length} placeholder baseline rule(s) (Microsoft.OSConfig/BaselineRule) imported from an Azure Policy Guest Configuration catalog. These carry rule identity but no implementation, so the resulting policy would silently report every VM as Compliant without actually checking anything. Map each placeholder to a concrete resource type (Microsoft.Windows/Registry, Microsoft.OSConfig/FileLine, etc.) with real implementation details first. Affected: ${sample}${more}.`,
      );
    }

    // Pick OS: explicit caller override > auto-detect from resources >
    // default 'Windows' (most common case for fresh manifests with no
    // resources yet).
    const detected = inferOsTypeFromResources(manifestResources);
    const osType = req.osType ?? detected ?? 'Windows';
    const metadata = extractManifestMetadata(parsedManifest, sourceYaml);

    const body = exportToAzurePolicy(req.name, manifestResources, {
      effect: req.effect ?? 'AuditIfNotExists',
      osType,
      ...metadata,
    });
    return {
      filename,
      contentType: CONTENT_TYPES.azurepolicy,
      body,
      cacheable: false,
    };
  }

  const needsLive = !sourceYaml || (format === 'excel' && manifestResources.length === 0);
  const liveResources = needsLive ? (await getResources({ namespace })).data ?? [] : [];

  let body: string;
  switch (format) {
    case 'yaml':
      body = sourceYaml ?? resourcesToYaml(namespace, liveResources);
      break;
    case 'json': {
      const manifestObj =
        parsedManifest ??
        ({
          $schema: 'https://aka.ms/osc/schemas/prerelease/document.json',
          resources: liveResources,
        } as Record<string, unknown>);
      body = exportToJson(manifestObj);
      break;
    }
    case 'mof': {
      const resourcesForMof =
        manifestResources.length > 0 ? manifestResources : (liveResources as unknown[]);
      body = exportToMof(req.name, resourcesForMof);
      break;
    }
    case 'excel': {
      const resourcesForCsv =
        manifestResources.length > 0 ? manifestResources : (liveResources as unknown[]);
      const rows = flattenResourcesToRows(resourcesForCsv);
      body = exportToExcel(rows as unknown as Parameters<typeof exportToExcel>[0]);
      break;
    }
    default:
      body = exportToYaml({});
  }

  const cacheable =
    (format === 'yaml' || format === 'json' || format === 'mof') && Boolean(sourceYaml);

  return {
    filename,
    contentType: CONTENT_TYPES[format],
    body,
    cacheable,
  };
}
