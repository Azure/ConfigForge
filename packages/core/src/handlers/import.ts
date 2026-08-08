// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure handler for `cfs:import:fromContent` and POST /api/import.
 *
 * Takes a filename plus text content or binary workbook bytes and detects the file type from
 * the extension, then delegates to the appropriate parser:
 *
 *   .osc.yaml / .osc.yml / .yaml / .yml  → parseOscYaml
 *   .json                                 → manifest-JSON or security-definition
 *   .csv / .tsv                           → parseExcelBaseline
 *   .xlsx                                 → XLSX worksheet extraction + parseExcelBaseline
 *
 * The two hosts differ in HOW they obtain `content`:
 *
 *   - Next.js: extracts the file from multipart/form-data on the
 *     request, reads .text(), passes here.
 *   - Electron: opens dialog.showOpenDialog, reads the selected file
 *     from disk, passes here.
 *
 * This handler doesn't care which host obtained the payload — it just parses + validates.
 */
import {
  parseOscYaml,
  parseSecurityDefinition,
  parseExcelBaseline,
  buildBaselineManifest,
  exportToYaml,
  inferRegistryValueType,
  type ParsedSDSetting,
  type ParsedSecurityDefinition,
} from '../import-export';
import { parseLosslessJson } from '../manifest/lossless';
import { HandlerError } from './errors';
import { xlsxToDelimitedText } from './xlsx-import';

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024; // 10 MB

export type DetectedType = 'osc-yaml' | 'yaml' | 'json' | 'csv' | 'xlsx';

export { inferRegistryValueType };

export interface ImportRequest {
  filename: string;
  content?: string;
  bytes?: Uint8Array;
}

export interface ImportResult {
  type: 'manifest' | 'security-definition' | 'baseline-spreadsheet';
  filename: string;
  data: Record<string, unknown>;
  yaml: string;
}

export function detectFileType(filename: string): DetectedType {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.osc.yaml') || lower.endsWith('.osc.yml')) return 'osc-yaml';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) return 'csv';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  return 'yaml';
}

/**
 * One of the JSON shapes we recognise. The importer dispatches on this
 * tag instead of an opaque chain of `if (Array.isArray(...))` checks
 * — that previously made it easy to fall through to "Unrecognized JSON
 * shape" for files that should have been handled (e.g. embedded
 * `source` YAML that also had an empty `resources: []` array would
 * silently parse as a 0-resource manifest, the worst kind of failure).
 */
type JsonImportShape =
  | { kind: 'manifest'; doc: Record<string, unknown> }
  | { kind: 'embeddedSource'; source: string }
  | { kind: 'securityDefinition'; doc: Record<string, unknown> }
  | { kind: 'policyDefinition'; doc: Record<string, unknown> }
  | { kind: 'ruleMetadata'; doc: Record<string, unknown> }
  | { kind: 'emptyManifest' }
  | { kind: 'unknown' };

function detectJsonImportShape(doc: Record<string, unknown>): JsonImportShape {
  const hasResourcesArray = Array.isArray(doc.resources);
  const resourcesLen = hasResourcesArray ? (doc.resources as unknown[]).length : 0;
  const source =
    typeof doc.source === 'string' && (doc.source as string).trim().length > 0
      ? (doc.source as string)
      : undefined;

  // 1. A real manifest with at least one resource — take it as-is.
  if (hasResourcesArray && resourcesLen > 0) {
    return { kind: 'manifest', doc };
  }

  // 2. Embedded `source` field containing a YAML manifest. This is the
  // shape `Microsoft-Defender-Antivirus.json` and similar
  // CSV→YAML→JSON-wrapped baseline packages use. Before this change,
  // the empty top-level `resources: []` made these files silently
  // import as 0-resource manifests.
  if (source && /(?:^|\n)[ \t]*resources[ \t]*:/.test(source)) {
    return { kind: 'embeddedSource', source };
  }

  // 3. Security-definition shapes (Settings / settings / settingsReference
  //    / desiredConfiguration). The parser handles all four; we just
  //    detect that one of the recognised arrays is present.
  if (
    Array.isArray(doc.settingsReference) ||
    Array.isArray(doc.Settings) ||
    Array.isArray(doc.settings) ||
    Array.isArray(doc.desiredConfiguration)
  ) {
    return { kind: 'securityDefinition', doc };
  }

  // 4. Azure Policy Definition wrapper (the JSON you'd PUT against the
  //    Policy REST API). The actual settings live in the referenced
  //    Guest Configuration package, not in this file.
  const props = doc.properties as Record<string, unknown> | undefined;
  if (props && typeof props === 'object' && props.policyRule) {
    return { kind: 'policyDefinition', doc };
  }

  // 5. Rule-metadata reference (descriptions / remediation steps,
  //    paired to a baseline by ruleId). No enforcement values.
  if (Array.isArray(doc.rules) && (doc.rules as unknown[]).length > 0) {
    const first = (doc.rules as unknown[])[0] as Record<string, unknown> | undefined;
    if (first && typeof first === 'object' && (first.ruleId || first.RuleId)) {
      return { kind: 'ruleMetadata', doc };
    }
  }

  // 6. A `resources: []` array with no other recognisable content —
  //    intentional empty manifest? Almost certainly not what the user
  //    wanted. Surface it as an explicit error instead of silently
  //    "succeeding."
  if (hasResourcesArray && resourcesLen === 0) {
    return { kind: 'emptyManifest' };
  }

  return { kind: 'unknown' };
}

/**
 * Sanitise a string for use as an oscfg resource `name`. Mirrors the
 * convention in the CSV importer (alphanumerics + `_` + `-` only).
 */
function safeResourceName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'rule';
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Build a manifest from a security-definition where the source carried
 * concrete Registry hints (Path / registryPath + ExpectedValue). This
 * is the legacy shape and the historical behaviour of this handler —
 * preserve it exactly so existing baselines round-trip the same way.
 */
function buildRegistryManifestFromSettings(settings: ParsedSDSetting[]): {
  $schema: string;
  resources: unknown[];
} {
  return {
    $schema: 'https://aka.ms/osc/schemas/prerelease/document.json',
    resources: settings.map((s) => ({
      name: safeResourceName(s.name),
      type: 'Microsoft.Windows/Registry',
      properties: {
        ...(s.keyPath ? { keyPath: s.keyPath } : {}),
        // Schema requires valueName + valueType for Registry resources.
        // Security-definition rows don't carry these fields, so we
        // derive valueName from the setting name and infer valueType
        // from expectedValue.
        valueName: s.name,
        valueType: inferRegistryValueType(s.expectedValue),
      },
      ...(s.expectedValue !== undefined ? { compliance: { equals: s.expectedValue } } : {}),
    })),
  };
}

/**
 * Build a manifest from an Azure Policy Guest Configuration baseline
 * catalog (the `settingsReference[]` shape).
 *
 * IMPORTANT: these entries carry only the rule IDENTITY — ruleId,
 * displayName, severity — not the implementation (no registry path /
 * file path / command line). The OSConfig agent on the target machine
 * is the only thing that knows how to evaluate them. So we deliberately
 * do NOT pretend they're `Microsoft.Windows/Registry` resources with
 * synthetic placeholder keyPaths — that would let users build a fake
 * audit/deploy manifest that silently reports "compliant" by checking
 * registry keys that don't exist. False compliance is worse than no
 * compliance.
 *
 * Instead we emit `Microsoft.OSConfig/BaselineRule` resources that are
 * honest placeholders:
 *   - They preserve every field from the source (ruleId, displayName,
 *     severity, schema type, default value).
 *   - The editor's schema validator will flag them as an unknown type
 *     (this is the desired signal — "you need to map these before
 *     deployment").
 *   - The oscfg CLI does not recognise this type, so audit/deploy will
 *     fail with a clear error instead of silently faking compliance.
 *   - Matrix diff, search, library browse, and rename all still work
 *     — the manifest is editable, just not deployable as-is.
 *
 * Duplicate display names (yes, this happens — `settings.json` has
 * two "Ensure AppArmor is installed" entries with different ruleIds)
 * are disambiguated by suffixing ALL occurrences with the first 8 chars
 * of their ruleId so the original is never the bare name and the
 * suffixed ones aren't confusingly second-class.
 */
function buildPlaceholderManifestFromSettingsReference(settings: ParsedSDSetting[]): {
  $schema: string;
  resources: unknown[];
} {
  const nameCounts = new Map<string, number>();
  for (const s of settings) {
    const k = safeResourceName(s.name);
    nameCounts.set(k, (nameCounts.get(k) ?? 0) + 1);
  }

  const usedNames = new Set<string>();
  const resources = settings.map((s) => {
    const baseName = safeResourceName(s.name);
    const isDup = (nameCounts.get(baseName) ?? 0) > 1;
    let finalName = baseName;
    if (isDup && s.ruleId) {
      // Suffix every duplicate (including the first), so the original
      // is never the "winner."
      const shortId = s.ruleId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
      finalName = `${baseName}-${shortId}`;
    }
    // Edge case: two ruleIds share the first 8 alphanumeric chars. Walk
    // to a numeric counter suffix.
    let attempt = finalName;
    let counter = 2;
    while (usedNames.has(attempt)) {
      attempt = `${finalName}-${counter}`;
      counter++;
    }
    usedNames.add(attempt);

    return {
      name: attempt,
      type: 'Microsoft.OSConfig/BaselineRule',
      properties: {
        ...(s.ruleId ? { ruleId: s.ruleId } : {}),
        ...(s.description ? { displayName: s.description } : {}),
        ...(s.severity ? { severity: s.severity } : {}),
        ...(s.schemaType ? { schemaType: s.schemaType } : {}),
        ...(s.originalSettingName && s.originalSettingName !== s.name
          ? { originalSettingName: s.originalSettingName }
          : {}),
      },
      ...(s.expectedValue !== undefined ? { compliance: { equals: s.expectedValue } } : {}),
    };
  });

  return {
    $schema: 'https://aka.ms/osc/schemas/prerelease/document.json',
    resources,
  };
}

/**
 * Prepend a banner comment to a placeholder-baseline YAML so the user
 * sees WHY their imported manifest can't be deployed as-is the moment
 * they open the editor. `js-yaml.dump` doesn't preserve comments, so
 * we splice this in after dumping.
 */
function placeholderBaselineBanner(parsed: ParsedSecurityDefinition): string {
  const lines: string[] = [
    '# ────────────────────────────────────────────────────────────────────',
    '# Imported from Azure Policy Guest Configuration baseline:',
    `#   ${parsed.name}${parsed.version ? ` v${parsed.version}` : ''}`,
    `#   ${parsed.settings.length} rules`,
    '#',
    '# Each resource below is a PLACEHOLDER carrying the original rule',
    '# identity (ruleId, displayName, severity). The OSConfig agent on',
    '# the target machine is the only thing that knows how to evaluate',
    '# these rules, so the manifest is NOT deployable as-is from',
    '# ConfigForge — audit/deploy will fail until each resource is',
    '# mapped to a concrete type (Microsoft.Windows/Registry,',
    '# Microsoft.OSConfig/FileLine, etc.) with real implementation details.',
    '#',
    '# You CAN use this manifest to:',
    '#   - Browse, rename, and organise rules',
    '#   - Diff two baseline versions against each other',
    '#   - Export to CSV / XLSX for review',
    '# ────────────────────────────────────────────────────────────────────',
    '',
  ];
  return lines.join('\n');
}

/**
 * Build a friendly 400 error for the Azure Policy Definition wrapper
 * shape — the JSON you would PUT against the Policy REST API. The
 * baseline content lives in a SEPARATE Guest Configuration package;
 * this file only references it by name/version.
 */
function policyDefinitionRejection(doc: Record<string, unknown>): HandlerError {
  const props = (doc.properties ?? {}) as Record<string, unknown>;
  const displayName = typeof props.displayName === 'string' ? props.displayName : undefined;
  const metadata = (props.metadata ?? {}) as Record<string, unknown>;
  const gc = (metadata.guestConfiguration ?? {}) as Record<string, unknown>;
  const gcName = typeof gc.name === 'string' ? gc.name : undefined;
  const gcVersion = typeof gc.version === 'string' ? gc.version : undefined;
  const policyRule = (props.policyRule ?? {}) as Record<string, unknown>;
  const then = (policyRule.then ?? {}) as Record<string, unknown>;
  const details = (then.details ?? {}) as Record<string, unknown>;
  const assignmentName = typeof details.name === 'string' ? details.name : undefined;

  const parts = ['This is an Azure Policy Definition wrapper, not a baseline manifest.'];
  if (displayName) parts.push(`Policy: "${displayName}".`);
  const assignment = gcName ?? assignmentName;
  if (assignment) {
    parts.push(
      `It assigns Guest Configuration package "${assignment}"${
        gcVersion ? ` v${gcVersion}` : ''
      }; import that package's baseline JSON instead.`,
    );
  } else {
    parts.push(
      'Import the underlying Guest Configuration baseline JSON (the file with a settingsReference[] array) instead.',
    );
  }
  return new HandlerError(400, parts.join(' '));
}

/**
 * Build a friendly 400 error for the rule-metadata reference shape
 * (e.g. Ubuntu2204Metadata.json). These files carry descriptions,
 * remediation scripts, and compliance-standard tags but no enforcement
 * values — they pair with a baseline JSON by ruleId.
 */
function ruleMetadataRejection(doc: Record<string, unknown>): HandlerError {
  const id = typeof doc.id === 'string' ? doc.id : 'Unknown';
  const version = typeof doc.version === 'string' ? doc.version : undefined;
  const ruleCount = Array.isArray(doc.rules) ? (doc.rules as unknown[]).length : 0;
  return new HandlerError(
    400,
    `This is a baseline rule-metadata reference file (descriptions and remediation steps for "${id}"${
      version ? ` v${version}` : ''
    }, ${ruleCount} rules), not a baseline manifest. Metadata files cannot be imported on their own — import the matching baseline JSON (the file with a settingsReference[] array) instead.`,
  );
}

export function importFile(req: ImportRequest): ImportResult {
  if (!req || typeof req !== 'object') {
    throw new HandlerError(400, 'Request must include filename plus content or bytes');
  }
  if (typeof req.filename !== 'string' || !req.filename) {
    throw new HandlerError(400, 'filename is required');
  }
  const hasContent = typeof req.content === 'string';
  const hasBytes = req.bytes instanceof Uint8Array;
  if (hasContent === hasBytes) {
    throw new HandlerError(400, 'Request must include exactly one of content or bytes');
  }
  const byteLength = hasBytes ? req.bytes!.byteLength : Buffer.byteLength(req.content!, 'utf-8');
  if (byteLength > MAX_IMPORT_BYTES) {
    throw new HandlerError(
      413,
      `File too large (${byteLength.toLocaleString()} bytes). Limit: ${MAX_IMPORT_BYTES.toLocaleString()} bytes (10 MB).`,
    );
  }
  if ((hasContent && !req.content!.trim()) || (hasBytes && req.bytes!.byteLength === 0)) {
    throw new HandlerError(400, 'File is empty');
  }

  const fileType = detectFileType(req.filename);
  if (fileType === 'xlsx' && !hasBytes) {
    throw new HandlerError(400, 'Excel workbooks must be imported as binary bytes');
  }
  if (fileType !== 'xlsx' && !hasContent) {
    throw new HandlerError(400, 'Text-based imports require string content');
  }
  const content = req.content ?? '';

  switch (fileType) {
    case 'osc-yaml':
    case 'yaml': {
      const parsed = parseOscYaml(content);
      return {
        type: 'manifest',
        filename: req.filename,
        data: {
          schema: parsed.$schema,
          resourceCount: parsed.resources.length,
          resources: parsed.resources,
        },
        yaml: parsed.raw,
      };
    }

    case 'json': {
      let parsedJson: unknown;
      try {
        parsedJson = parseLosslessJson(content);
      } catch {
        throw new HandlerError(400, 'File is not valid JSON');
      }
      if (!parsedJson || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
        throw new HandlerError(400, 'JSON manifest must be an object');
      }

      const asObj = parsedJson as Record<string, unknown>;
      const shape = detectJsonImportShape(asObj);

      switch (shape.kind) {
        case 'manifest': {
          const yamlStr = exportToYaml(shape.doc);
          return {
            type: 'manifest',
            filename: req.filename,
            data: {
              schema: (shape.doc.$schema as string | undefined) ?? undefined,
              resourceCount: (shape.doc.resources as unknown[]).length,
              resources: shape.doc.resources as unknown[],
            },
            yaml: yamlStr,
          };
        }

        case 'embeddedSource': {
          // JSON wrapper carried a YAML manifest in `source`. Parse the
          // YAML and let it flow through the regular manifest path so
          // all the usual validation applies.
          const parsed = parseOscYaml(shape.source);
          return {
            type: 'manifest',
            filename: req.filename,
            data: {
              schema: parsed.$schema,
              resourceCount: parsed.resources.length,
              resources: parsed.resources,
            },
            yaml: parsed.raw,
          };
        }

        case 'securityDefinition': {
          const parsed = parseSecurityDefinition(content);
          const manifest =
            parsed.origin === 'settingsReference'
              ? buildPlaceholderManifestFromSettingsReference(parsed.settings)
              : buildRegistryManifestFromSettings(parsed.settings);
          const yamlBody = exportToYaml(manifest);
          const yamlStr =
            parsed.origin === 'settingsReference'
              ? placeholderBaselineBanner(parsed) + yamlBody
              : yamlBody;
          return {
            type: 'security-definition',
            filename: req.filename,
            data: {
              name: parsed.name,
              version: parsed.version,
              description: parsed.description,
              origin: parsed.origin,
              settingCount: parsed.settings.length,
              settings: parsed.settings,
            },
            yaml: yamlStr,
          };
        }

        case 'policyDefinition':
          throw policyDefinitionRejection(shape.doc);

        case 'ruleMetadata':
          throw ruleMetadataRejection(shape.doc);

        case 'emptyManifest':
          throw new HandlerError(
            400,
            'This JSON has an empty `resources: []` array and no other importable content. If the file is supposed to wrap a YAML manifest, ensure the embedded `source` field contains the manifest text.',
          );

        case 'unknown':
        default:
          throw new HandlerError(
            400,
            'Unrecognized JSON shape. Recognised shapes: oscfg manifest (non-empty `resources` array), embedded YAML manifest in a `source` field, security definition (with a `Settings` / `settings` / `desiredConfiguration` array), or Azure Policy Guest Configuration baseline (with a `settingsReference` array).',
          );
      }
    }

    case 'csv': {
      return spreadsheetImportResult(req.filename, parseExcelBaseline(content));
    }

    case 'xlsx': {
      return spreadsheetImportResult(
        req.filename,
        parseExcelBaseline(xlsxToDelimitedText(req.bytes!)),
      );
    }

    default:
      throw new HandlerError(400, `Unsupported file type: ${req.filename}`);
  }
}

function spreadsheetImportResult(
  filename: string,
  settings: ReturnType<typeof parseExcelBaseline>,
): ImportResult {
  const built = buildBaselineManifest(settings);
  return {
    type: 'baseline-spreadsheet',
    filename,
    data: {
      settingCount: built.manifest.resources.length,
      sourceSettingCount: settings.length,
      skippedSettingCount: built.skippedSettings.length,
      profile: built.profile,
      settings: built.includedSettings,
    },
    yaml: exportToYaml(built.manifest),
  };
}
