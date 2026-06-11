// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * CF-SEC-002 — IPC validator unit tests.
 *
 * These validators are the FIRST trust boundary at the renderer↔main
 * IPC seam. The pure handlers downstream re-validate, but the IPC
 * layer fails fast (no allocations, no lazy-imports) on payloads
 * that are obviously malformed or oversized.
 *
 * We assert both directions:
 *   - well-formed payloads pass (return null)
 *   - malformed payloads return a descriptive error string
 *   - payloads above the size cap are rejected even if the shape is
 *     correct
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_MANIFEST_CONTENT_LEN,
  MAX_MANIFEST_NAME_LEN,
  validateAppendRationaleRequest,
  validateDeleteSnapshotRequest,
  validateDeployRequest,
  validateDocsGenerateRequest,
  validateImportRequest,
  validateRegisterManifestRequest,
  validateRevertRequest,
  validateSaveSnapshotRequest,
} from './ipc-validators';

describe('validateRevertRequest', () => {
  it('accepts a valid request', () => {
    expect(validateRevertRequest({ name: 'cis-baseline' })).toBeNull();
  });

  it('rejects non-objects', () => {
    expect(validateRevertRequest(null)).toMatch(/object/);
    expect(validateRevertRequest('cis-baseline')).toMatch(/object/);
    expect(validateRevertRequest(42)).toMatch(/object/);
  });

  it('rejects missing or empty name', () => {
    expect(validateRevertRequest({})).toMatch(/name/);
    expect(validateRevertRequest({ name: '' })).toMatch(/name/);
  });

  it('rejects oversized name', () => {
    expect(
      validateRevertRequest({ name: 'a'.repeat(MAX_MANIFEST_NAME_LEN + 1) }),
    ).toMatch(/maximum length/);
  });

  it('rejects non-string name', () => {
    expect(validateRevertRequest({ name: 42 })).toMatch(/name/);
  });
});

describe('validateSaveSnapshotRequest', () => {
  it('accepts valid minimal payload', () => {
    expect(
      validateSaveSnapshotRequest({ name: 'x', content: 'resources: []' }),
    ).toBeNull();
  });

  it('accepts an optional message', () => {
    expect(
      validateSaveSnapshotRequest({ name: 'x', content: 'r', message: 'note' }),
    ).toBeNull();
  });

  it('rejects huge content', () => {
    const huge = 'a'.repeat(MAX_MANIFEST_CONTENT_LEN + 1);
    expect(
      validateSaveSnapshotRequest({ name: 'x', content: huge }),
    ).toMatch(/maximum length/);
  });

  it('rejects non-string content', () => {
    expect(validateSaveSnapshotRequest({ name: 'x', content: 42 })).toMatch(/content/);
  });

  it('rejects non-string message', () => {
    expect(
      validateSaveSnapshotRequest({ name: 'x', content: 'r', message: 7 }),
    ).toMatch(/message/);
  });
});

describe('validateDeleteSnapshotRequest', () => {
  it('accepts a valid request', () => {
    expect(validateDeleteSnapshotRequest({ name: 'x', id: 'snap1' })).toBeNull();
  });

  it('rejects missing id', () => {
    expect(validateDeleteSnapshotRequest({ name: 'x' })).toMatch(/id/);
  });

  it('rejects empty id', () => {
    expect(validateDeleteSnapshotRequest({ name: 'x', id: '' })).toMatch(/id/);
  });
});

describe('validateAppendRationaleRequest', () => {
  it('accepts the canonical payload', () => {
    expect(
      validateAppendRationaleRequest({
        id: 'cis-baseline',
        resourceName: 'PasswordComplexity',
        reason: 'audit-only check',
      }),
    ).toBeNull();
  });

  it('accepts skipped=true without a reason', () => {
    expect(
      validateAppendRationaleRequest({
        id: 'cis-baseline',
        resourceName: 'PasswordComplexity',
        skipped: true,
      }),
    ).toBeNull();
  });

  it('rejects missing resourceName', () => {
    expect(
      validateAppendRationaleRequest({ id: 'cis-baseline', reason: 'x' }),
    ).toMatch(/resourceName/);
  });

  it('rejects non-boolean skipped', () => {
    expect(
      validateAppendRationaleRequest({
        id: 'x',
        resourceName: 'y',
        reason: 'z',
        skipped: 'yes',
      }),
    ).toMatch(/skipped/);
  });
});

describe('validateRegisterManifestRequest', () => {
  it('accepts a name + content payload', () => {
    expect(
      validateRegisterManifestRequest({
        name: 'x',
        content: 'resources: []',
        source: 'user',
      }),
    ).toBeNull();
  });

  it('rejects path field (CF-SEC-017 — legacy arbitrary file-read surface removed in v0.2.21)', () => {
    const err = validateRegisterManifestRequest({ name: 'x', path: '/tmp/x.yaml' });
    expect(err).toBeTruthy();
    expect(err).toMatch(/path/i);
  });

  it('rejects huge content', () => {
    expect(
      validateRegisterManifestRequest({
        name: 'x',
        content: 'a'.repeat(MAX_MANIFEST_CONTENT_LEN + 1),
      }),
    ).toMatch(/maximum length/);
  });

  it('rejects non-string source', () => {
    expect(
      validateRegisterManifestRequest({ name: 'x', content: 'r', source: 42 }),
    ).toMatch(/source/);
  });
});

describe('validateImportRequest', () => {
  it('accepts a valid payload', () => {
    expect(
      validateImportRequest({ filename: 'base.yaml', content: 'resources: []' }),
    ).toBeNull();
  });

  it('rejects missing filename', () => {
    expect(validateImportRequest({ content: 'r' })).toMatch(/filename/);
  });

  it('rejects huge content', () => {
    expect(
      validateImportRequest({
        filename: 'x',
        content: 'a'.repeat(MAX_MANIFEST_CONTENT_LEN + 1),
      }),
    ).toMatch(/maximum length/);
  });

  it('rejects non-string content', () => {
    expect(validateImportRequest({ filename: 'x', content: 42 })).toMatch(/content/);
  });
});

describe('validateDeployRequest', () => {
  it('accepts a minimal deploy', () => {
    expect(validateDeployRequest({ name: 'cis-baseline' })).toBeNull();
  });

  it('accepts audit and enforce modes', () => {
    expect(validateDeployRequest({ name: 'x', mode: 'audit' })).toBeNull();
    expect(validateDeployRequest({ name: 'x', mode: 'enforce' })).toBeNull();
  });

  it('accepts an opaque jobId of bounded length', () => {
    expect(
      validateDeployRequest({ name: 'x', jobId: 'job-1234-abcd' }),
    ).toBeNull();
  });

  it('rejects invalid mode value', () => {
    expect(validateDeployRequest({ name: 'x', mode: 'wipe' })).toMatch(/mode/);
  });

  it('rejects oversized jobId', () => {
    expect(
      validateDeployRequest({ name: 'x', jobId: 'a'.repeat(200) }),
    ).toMatch(/jobId/);
  });

  it('rejects non-string scenarioName', () => {
    expect(
      validateDeployRequest({ name: 'x', scenarioName: 42 }),
    ).toMatch(/scenarioName/);
  });
});

describe('validateDocsGenerateRequest', () => {
  it('accepts valid payload', () => {
    expect(
      validateDocsGenerateRequest({ name: 'x', content: 'resources: []' }),
    ).toBeNull();
  });

  it('rejects empty content', () => {
    expect(validateDocsGenerateRequest({ name: 'x', content: '' })).toMatch(
      /content/,
    );
  });

  it('rejects huge content', () => {
    expect(
      validateDocsGenerateRequest({
        name: 'x',
        content: 'a'.repeat(MAX_MANIFEST_CONTENT_LEN + 1),
      }),
    ).toMatch(/maximum length/);
  });
});
