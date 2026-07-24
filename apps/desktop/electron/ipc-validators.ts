// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * CF-SEC-002 — IPC payload validators.
 *
 * The Electron `ipcMain.handle(...)` boundary is the first place
 * renderer-controlled input crosses into the privileged main process.
 * Several pre-existing channels previously cast `unknown` straight to
 * typed request shapes, leaving the downstream `@configforge/core`
 * handler to do all the validation — which is fine for correctness
 * but means a compromised renderer can:
 *
 *   1. Allocate huge strings on the main-process side before any
 *      downstream guard fires (`history:save` with a 5 GB `content`,
 *      `import:fromContent` with a 1 GB `content`).
 *   2. Trip lazy-imports of heavy modules (pdfkit, xlsx-builder, etc.)
 *      with garbage payloads.
 *
 * These validators are the FIRST trust boundary: shape + length-cap
 * checks that fail fast with a clear error envelope. Each pure
 * handler in core still re-validates internally — these IPC layer
 * checks are defense-in-depth, not a replacement.
 *
 * Each `validate*` returns a string error (suitable for `envelope()`)
 * on failure, or `null` on success.
 */

// IPC payload size caps. These bound the worst-case memory pressure a
// compromised renderer can apply by passing validly-shaped but
// enormous strings through privileged channels. The pure handlers
// downstream also enforce their own (often tighter) size limits.
export const MAX_MANIFEST_NAME_LEN = 256;
export const MAX_SNAPSHOT_ID_LEN = 256;
export const MAX_HISTORY_MESSAGE_LEN = 2048;
export const MAX_MANIFEST_CONTENT_LEN = 10 * 1024 * 1024; // 10 MB — matches MAX_IMPORT_BYTES
export const MAX_RATIONALE_REASON_LEN = 4096; // core caps at 500; this is the IPC outer bound
export const MAX_RESOURCE_NAME_LEN = 1024;
export const MAX_JOB_ID_LEN = 128;
export const MAX_FILENAME_LEN = 1024;

export function validateNonEmptyString(
  value: unknown,
  name: string,
  max: number,
): string | null {
  if (typeof value !== 'string') return `${name} must be a string`;
  if (value.length === 0) return `${name} must be a non-empty string`;
  if (value.length > max) return `${name} exceeds maximum length (${max})`;
  return null;
}

export function validateOptionalString(
  value: unknown,
  name: string,
  max: number,
): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string') return `${name} must be a string when provided`;
  if (value.length > max) return `${name} exceeds maximum length (${max})`;
  return null;
}

export function validateRevertRequest(v: unknown): string | null {
  if (typeof v !== 'object' || v === null) return 'payload must be an object';
  const o = v as Record<string, unknown>;
  return validateNonEmptyString(o.name, 'name', MAX_MANIFEST_NAME_LEN);
}

export function validateSaveSnapshotRequest(v: unknown): string | null {
  if (typeof v !== 'object' || v === null) return 'payload must be an object';
  const o = v as Record<string, unknown>;
  const e1 = validateNonEmptyString(o.name, 'name', MAX_MANIFEST_NAME_LEN);
  if (e1) return e1;
  if (typeof o.content !== 'string') return 'content must be a string';
  if (o.content.length > MAX_MANIFEST_CONTENT_LEN) {
    return `content exceeds maximum length (${MAX_MANIFEST_CONTENT_LEN})`;
  }
  return validateOptionalString(o.message, 'message', MAX_HISTORY_MESSAGE_LEN);
}

export function validateDeleteSnapshotRequest(v: unknown): string | null {
  if (typeof v !== 'object' || v === null) return 'payload must be an object';
  const o = v as Record<string, unknown>;
  const e1 = validateNonEmptyString(o.name, 'name', MAX_MANIFEST_NAME_LEN);
  if (e1) return e1;
  return validateNonEmptyString(o.id, 'id', MAX_SNAPSHOT_ID_LEN);
}

export function validateAppendRationaleRequest(v: unknown): string | null {
  if (typeof v !== 'object' || v === null) return 'payload must be an object';
  const o = v as Record<string, unknown>;
  // The core handler does the strict namespace + reason validation;
  // we just cap the outer string lengths to avoid huge allocations.
  const e1 = validateNonEmptyString(o.id, 'id', MAX_MANIFEST_NAME_LEN);
  if (e1) return e1;
  const e2 = validateNonEmptyString(o.resourceName, 'resourceName', MAX_RESOURCE_NAME_LEN);
  if (e2) return e2;
  const e3 = validateOptionalString(o.reason, 'reason', MAX_RATIONALE_REASON_LEN);
  if (e3) return e3;
  if (o.skipped !== undefined && typeof o.skipped !== 'boolean') {
    return 'skipped must be a boolean when provided';
  }
  // `oldValue` / `newValue` are intentionally `unknown` — the core
  // handler narrows them.
  return null;
}

export function validateRegisterManifestRequest(v: unknown): string | null {
  if (typeof v !== 'object' || v === null) return 'payload must be an object';
  const o = v as Record<string, unknown>;
  const e1 = validateNonEmptyString(o.name, 'name', MAX_MANIFEST_NAME_LEN);
  if (e1) return e1;
  // Either `content`, `uri`, or `path` must be provided per the core
  // handler; we just enforce types + sane caps here.
  // v0.2.21 (CF-SEC-017): explicitly reject `path` in the validator
  // before the handler ever runs. The legacy field allowed arbitrary
  // host-file reads via a compromised renderer; the handler rejects
  // it too, but a validator-level reject is a defence-in-depth gate.
  if ((o as Record<string, unknown>).path !== undefined) {
    return 'the "path" field is no longer supported; pass YAML via "content" or "uri"';
  }
  for (const k of ['content', 'uri'] as const) {
    const e = validateOptionalString(o[k], k, MAX_MANIFEST_CONTENT_LEN);
    if (e) return e;
  }
  // `source` is enumerated downstream; we only cap length.
  const e2 = validateOptionalString(o.source, 'source', 64);
  if (e2) return e2;
  // v0.3.47: short change-summary string surfaced in History. Capped
  // tight (200 chars) so a compromised renderer can't smuggle a giant
  // payload into the history sidecar.
  const e3 = validateOptionalString(o.changeSummary, 'changeSummary', 200);
  if (e3) return e3;
  // v0.3.0 (#20): `force` is an optional boolean — used to bypass the
  // namespace-collision warning when the caller has already shown
  // the user a confirmation.
  if (o.force !== undefined && typeof o.force !== 'boolean') {
    return 'force must be boolean when provided';
  }
  return null;
}

export function validateRestoreManifestRequest(v: unknown): string | null {
  if (typeof v !== 'object' || v === null) return 'payload must be an object';
  const o = v as Record<string, unknown>;
  const namespaceError = validateNonEmptyString(
    o.namespace,
    'namespace',
    MAX_MANIFEST_NAME_LEN,
  );
  if (namespaceError) return namespaceError;
  const displayNameError = validateNonEmptyString(
    o.displayName,
    'displayName',
    MAX_MANIFEST_NAME_LEN,
  );
  if (displayNameError) return displayNameError;
  const contentError = validateNonEmptyString(
    o.content,
    'content',
    MAX_MANIFEST_CONTENT_LEN,
  );
  if (contentError) return contentError;
  if (o.source !== 'user' && o.source !== 'library' && o.source !== 'import') {
    return 'source must be user, library, or import';
  }
  return validateOptionalString(o.sourceId, 'sourceId', MAX_FILENAME_LEN);
}

export function validateDeleteManifestRequest(v: unknown): string | null {
  if (typeof v !== 'object' || v === null) return 'payload must be an object';
  const o = v as Record<string, unknown>;
  const nameError = validateNonEmptyString(o.name, 'name', MAX_MANIFEST_NAME_LEN);
  if (nameError) return nameError;
  if (o.requireRecovery !== undefined && typeof o.requireRecovery !== 'boolean') {
    return 'requireRecovery must be a boolean when provided';
  }
  return null;
}

/**
 * v0.2.21 (CF-SEC-018): validator for `cfs:manifests:list` payload.
 *
 * The list handler accepts `{ live?, includeResources?, lite?, force? }`.
 * Previously the IPC channel cast the renderer payload directly with
 * no shape check — inconsistent with every other mutating channel
 * and a maintenance hazard if `listManifests` ever grows a parameter
 * with a side-effect. Validator is intentionally permissive
 * (omitted payload is valid) but enforces boolean types when keys
 * are present.
 */
export function validateListManifestsRequest(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object') return 'payload must be an object or omitted';
  const o = v as Record<string, unknown>;
  for (const k of ['live', 'includeResources', 'lite', 'force'] as const) {
    if (o[k] !== undefined && typeof o[k] !== 'boolean') {
      return `${k} must be boolean when provided`;
    }
  }
  return null;
}

export function validateImportRequest(v: unknown): string | null {
  if (typeof v !== 'object' || v === null) return 'payload must be an object';
  const o = v as Record<string, unknown>;
  const e1 = validateNonEmptyString(o.filename, 'filename', MAX_FILENAME_LEN);
  if (e1) return e1;
  const hasContent = typeof o.content === 'string';
  const hasBytes = o.bytes instanceof Uint8Array;
  if (hasContent === hasBytes) {
    return 'exactly one of content or bytes must be provided';
  }
  if (hasContent && o.content.length > MAX_MANIFEST_CONTENT_LEN) {
    return `content exceeds maximum length (${MAX_MANIFEST_CONTENT_LEN})`;
  }
  if (hasBytes && o.bytes.byteLength > MAX_MANIFEST_CONTENT_LEN) {
    return `bytes exceeds maximum length (${MAX_MANIFEST_CONTENT_LEN})`;
  }
  return null;
}

export function validateDeployRequest(v: unknown): string | null {
  if (typeof v !== 'object' || v === null) return 'payload must be an object';
  const o = v as Record<string, unknown>;
  const e1 = validateNonEmptyString(o.name, 'name', MAX_MANIFEST_NAME_LEN);
  if (e1) return e1;
  if (o.mode !== undefined && o.mode !== 'audit' && o.mode !== 'enforce') {
    return 'mode must be "audit" or "enforce" when provided';
  }
  // jobId is opaque — but cap length and require string.
  const e2 = validateOptionalString(o.jobId, 'jobId', MAX_JOB_ID_LEN);
  if (e2) return e2;
  const e3 = validateOptionalString(o.platform, 'platform', 64);
  if (e3) return e3;
  const e4 = validateOptionalString(o.scenarioName, 'scenarioName', 128);
  if (e4) return e4;
  return null;
}

export function validateDocsGenerateRequest(v: unknown): string | null {
  if (typeof v !== 'object' || v === null) return 'payload must be an object';
  const o = v as Record<string, unknown>;
  const e1 = validateNonEmptyString(o.name, 'name', MAX_MANIFEST_NAME_LEN);
  if (e1) return e1;
  if (typeof o.content !== 'string' || o.content.length === 0) {
    return 'content must be a non-empty string';
  }
  if (o.content.length > MAX_MANIFEST_CONTENT_LEN) {
    return `content exceeds maximum length (${MAX_MANIFEST_CONTENT_LEN})`;
  }
  return null;
}
