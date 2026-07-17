// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  writeAuditResult,
  readAuditResult,
  readAuditResultForRegistration,
  deleteAuditResult,
} from './audit-results-store';

/**
 * v0.1.6 audit-results store. Per-namespace cache of the last
 * deploy-time audit result, used by the audit pack so auditors get
 * the user's actual last-audit-run instead of only the on-demand
 * CIS-vs-user re-comparison.
 */
describe('audit-results-store', () => {
  let tmpHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpHome = mkdtempSync(path.join(tmpdir(), 'cf-audit-results-'));
    originalHome = process.env.CONFIGFORGE_HOME;
    process.env.CONFIGFORGE_HOME = tmpHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.CONFIGFORGE_HOME;
    else process.env.CONFIGFORGE_HOME = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  describe('write + read round-trip', () => {
    it('writes a new audit result and reads it back', async () => {
      const result = {
        Compliant: 318,
        NonCompliant: 12,
        Indeterminate: 2,
        Hostname: 'TESTBOX',
      };
      const written = await writeAuditResult(
        'cis-ws2022-ms',
        'audit',
        result,
        'registration-revision-1',
      );
      expect(written).not.toBeNull();

      const read = await readAuditResult('cis-ws2022-ms');
      expect(read).not.toBeNull();
      expect(read?.version).toBe(1);
      expect(read?.mode).toBe('audit');
      expect(read?.registrationRevision).toBe('registration-revision-1');
      expect(read?.result).toEqual(result);
      // recordedAt must be a parseable ISO string.
      expect(() => new Date(read!.recordedAt).toISOString()).not.toThrow();
    });

    it('persists the mode field for both audit and enforce', async () => {
      await writeAuditResult('ns-a', 'audit', { x: 1 });
      await writeAuditResult('ns-b', 'enforce', { y: 2 });
      expect((await readAuditResult('ns-a'))?.mode).toBe('audit');
      expect((await readAuditResult('ns-b'))?.mode).toBe('enforce');
    });

    it('overwrites a previous result for the same namespace', async () => {
      await writeAuditResult('ns', 'audit', { run: 'first' });
      await writeAuditResult('ns', 'enforce', { run: 'second' });
      const r = await readAuditResult('ns');
      expect((r?.result as { run: string }).run).toBe('second');
      expect(r?.mode).toBe('enforce');
    });
  });

  describe('absence handling', () => {
    it('returns null when no audit has run yet for the namespace', async () => {
      const r = await readAuditResult('never-audited');
      expect(r).toBeNull();
    });

    it('returns null for an invalid namespace shape (path-traversal guard)', async () => {
      // The store rejects names that sanitize to empty / only-dots.
      // Reading a fully-empty namespace must not throw — the audit-pack
      // handler relies on this fail-soft to avoid poisoning the whole
      // PDF when called with a malformed id.
      expect(await readAuditResult('')).toBeNull();
      expect(await readAuditResult('.')).toBeNull();
      expect(await readAuditResult('..')).toBeNull();
    });
  });

  describe('schema mismatch (forward-compat)', () => {
    it('returns null for a file with a future version field', async () => {
      const { writeFile, mkdir } = await import('fs/promises');
      await mkdir(path.join(tmpHome, 'audit-results'), { recursive: true });
      const file = path.join(tmpHome, 'audit-results', 'future.json');
      await writeFile(
        file,
        JSON.stringify({
          version: 999,
          recordedAt: '2026-01-01T00:00:00Z',
          mode: 'audit',
          result: {},
        }),
        'utf-8',
      );
      const r = await readAuditResult('future');
      expect(r).toBeNull();
    });

    it('returns null when the file is invalid JSON', async () => {
      const { writeFile, mkdir } = await import('fs/promises');
      await mkdir(path.join(tmpHome, 'audit-results'), { recursive: true });
      const file = path.join(tmpHome, 'audit-results', 'corrupt.json');
      await writeFile(file, '{ this is not json', 'utf-8');
      const r = await readAuditResult('corrupt');
      expect(r).toBeNull();
    });

    it('returns null when the mode field is unknown', async () => {
      const { writeFile, mkdir } = await import('fs/promises');
      await mkdir(path.join(tmpHome, 'audit-results'), { recursive: true });
      const file = path.join(tmpHome, 'audit-results', 'badmode.json');
      await writeFile(
        file,
        JSON.stringify({ version: 1, recordedAt: '2026-01-01T00:00:00Z', mode: 'wat', result: {} }),
        'utf-8',
      );
      const r = await readAuditResult('badmode');
      expect(r).toBeNull();
    });
  });

  describe('delete', () => {
    it('removes the on-disk file', async () => {
      await writeAuditResult('to-delete', 'audit', {});
      expect(await readAuditResult('to-delete')).not.toBeNull();
      await deleteAuditResult('to-delete');
      expect(await readAuditResult('to-delete')).toBeNull();
    });

    it('is a no-op when the file does not exist', async () => {
      // No throw, no error logged at fail level — just returns.
      await expect(deleteAuditResult('never-existed')).resolves.toBeUndefined();
    });

    it('is a no-op for invalid namespace input', async () => {
      await expect(deleteAuditResult('')).resolves.toBeUndefined();
      await expect(deleteAuditResult('..')).resolves.toBeUndefined();
    });

    it('hides a revision-mismatched audit and exposes the current revision', async () => {
      await writeAuditResult('revisioned', 'audit', { run: 'old' }, 'old');
      const currentRegistration = {
        modifiedAt: new Date().toISOString(),
        revision: 'current',
      };
      expect(
        await readAuditResultForRegistration('revisioned', currentRegistration),
      ).toBeNull();
      // The stale cache remains harmlessly on disk until a new audit replaces it.
      expect(await readAuditResult('revisioned')).not.toBeNull();

      await writeAuditResult('revisioned', 'audit', { run: 'current' }, 'current');
      expect(
        await readAuditResultForRegistration('revisioned', currentRegistration),
      ).toMatchObject({
        registrationRevision: 'current',
        result: { run: 'current' },
      });
    });

  });

  describe('namespace sanitization', () => {
    it('allows alphanumerics + dots + dashes + underscores', async () => {
      await writeAuditResult('cis-ws2022-ms.v1', 'audit', { ok: true });
      const r = await readAuditResult('cis-ws2022-ms.v1');
      expect(r).not.toBeNull();
    });

    it('collapses path-separator-like chars to dashes', async () => {
      // The store sanitizes both reads and writes consistently — a
      // namespace containing slashes lands at the same on-disk path
      // for both ops, so the round-trip succeeds.
      await writeAuditResult('foo/bar', 'audit', { ok: true });
      const r = await readAuditResult('foo/bar');
      expect(r).not.toBeNull();
    });
  });
});
