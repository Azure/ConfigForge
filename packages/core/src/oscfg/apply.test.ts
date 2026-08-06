// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Tests for the apply --content/--file size-threshold fallback (PR15).
 *
 * The bug: prior to PR15, applyManifest passed `opts.content` straight to
 * the CLI as `--content <yaml>`. On Windows, CreateProcessW caps the full
 * command line at 32,767 wchars — anything larger fails with
 * `ENAMETOOLONG` before oscfg even runs. Every WS baseline in
 * public/_baselines/ is between 50 KB and 130 KB, so enforce was
 * completely broken on Windows for them.
 *
 * Fix: when content > 8 KB, transparently write a temp file and pass
 * `-f` instead. This file unit-tests `planApply` (the pure dispatch
 * decision) directly so we don't need to spawn anything.
 */
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';
import { applyManifest, INLINE_CONTENT_BYTE_LIMIT, planApply } from './apply';
import { runOscfg } from './runner';

vi.mock('./runner', () => ({
  runOscfg: vi.fn(),
}));

const runOscfgMock = vi.mocked(runOscfg);

beforeEach(() => {
  vi.clearAllMocks();
  runOscfgMock.mockResolvedValue({
    success: true,
    data: '',
    error: null,
    exitCode: 0,
    stdout: '',
    stderr: '',
  });
});

describe('planApply — content/file dispatch', () => {
  it('generates apply content with canonical REG_DWORD for Dword input', () => {
    const tinyYaml = `resources:
  - name: registry
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKEY_LOCAL_MACHINE\\Software\\Inline
      valueName: Enabled
      valueType: Dword
      value: 1
`;
    const p = planApply({ content: tinyYaml, namespace: 'ns1' });
    expect(p.mode).toBe('inline');
    if (p.mode === 'inline') {
      expect(p.args.slice(0, 2)).toEqual(['apply', '--content']);
      expect(p.args.slice(-2)).toEqual(['-n', 'ns1']);
      const normalized = yaml.load(p.args[2]) as {
        resources: Array<{ properties: { keyPath: string; valueType: string } }>;
      };
      expect(normalized.resources[0].properties.keyPath).toBe(
        'HKEY_LOCAL_MACHINE:\\Software\\Inline',
      );
      expect(normalized.resources[0].properties.valueType).toBe('REG_DWORD');
      expect(p.args[2]).toContain('REG_DWORD');
    }
  });

  it('falls back to file mode with normalized content when the payload exceeds the byte threshold', () => {
    // 12 KB > 8 KB threshold
    const bigYaml =
      `resources:
  - name: registry
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM\\Software\\FileFallback
      valueName: Enabled
      valueType: REG_DWORD
      value: 1
` + '  - { name: r, type: T }\n'.repeat(500);
    expect(Buffer.byteLength(bigYaml, 'utf8')).toBeGreaterThan(INLINE_CONTENT_BYTE_LIMIT);
    const p = planApply({ content: bigYaml, namespace: 'ns2' });
    expect(p.mode).toBe('file');
    if (p.mode === 'file') {
      // No --content arg; -f with a placeholder the spawn layer fills
      expect(p.args).not.toContain('--content');
      expect(p.args).toContain('-f');
      expect(p.args[p.args.indexOf('-f') + 1]).toBe(p.tempFilePlaceholder);
      const normalized = yaml.load(p.content) as {
        resources: Array<{ properties?: { keyPath: string; valueType: string } }>;
      };
      expect(normalized.resources[0].properties?.keyPath).toBe(
        'HKLM:\\Software\\FileFallback',
      );
      expect(normalized.resources[0].properties?.valueType).toBe('REG_DWORD');
      expect(p.args).toContain('-n');
      expect(p.args[p.args.indexOf('-n') + 1]).toBe('ns2');
    }
  });

  it('plans a caller-supplied file through a normalized temporary copy', () => {
    const userFile = '/path/to/manifest.osc.yaml';
    const p = planApply({ file: userFile, namespace: 'ns3' });
    expect(p.mode).toBe('source-file');
    if (p.mode === 'source-file') {
      expect(p.sourceFile).toBe(userFile);
      expect(p.args).toEqual(['apply', '-f', p.tempFilePlaceholder, '-n', 'ns3']);
      expect(p.args).not.toContain(userFile);
    }
  });

  it('passes --dry-run through in inline mode', () => {
    const p = planApply({ content: 'small', namespace: 'ns', dryRun: true });
    expect(p.mode).toBe('inline');
    if (p.mode === 'inline') expect(p.args).toContain('--dry-run');
  });

  it('passes --dry-run through in file mode', () => {
    const bigYaml = '$schema: x\nresources:\n' + '  - { name: r, type: T }\n'.repeat(500);
    const p = planApply({ content: bigYaml, namespace: 'ns', dryRun: true });
    expect(p.mode).toBe('file');
    if (p.mode === 'file') expect(p.args).toContain('--dry-run');
  });

  it('omits -n when no namespace is supplied', () => {
    const p = planApply({ content: 'small' });
    expect(p.mode).toBe('inline');
    if (p.mode === 'inline') expect(p.args).not.toContain('-n');
  });

  it('returns an error plan when neither file nor content is supplied', () => {
    const p = planApply({ namespace: 'ns' });
    expect(p.mode).toBe('error');
    if (p.mode === 'error') expect(p.error).toMatch(/file or content/i);
  });

  it('handles UTF-8 byte-length correctly for the threshold check', () => {
    // String.length below threshold but byte-length above — common gotcha.
    const multibyte = '🎉'.repeat(2200); // 4 bytes per char ≈ 8.6 KB
    expect(multibyte.length).toBeLessThan(INLINE_CONTENT_BYTE_LIMIT);
    expect(Buffer.byteLength(multibyte, 'utf8')).toBeGreaterThan(INLINE_CONTENT_BYTE_LIMIT);
    const p = planApply({ content: multibyte, namespace: 'ns' });
    expect(p.mode).toBe('file');
  });

  it('exactly-at-threshold uses inline mode (boundary)', () => {
    // Build content at exactly 8 KB
    const exact = 'a'.repeat(INLINE_CONTENT_BYTE_LIMIT);
    expect(Buffer.byteLength(exact, 'utf8')).toBe(INLINE_CONTENT_BYTE_LIMIT);
    const p = planApply({ content: exact, namespace: 'ns' });
    expect(p.mode).toBe('inline');
  });

  it('one-byte-over-threshold uses file mode (boundary)', () => {
    const over = 'a'.repeat(INLINE_CONTENT_BYTE_LIMIT + 1);
    const p = planApply({ content: over, namespace: 'ns' });
    expect(p.mode).toBe('file');
  });

  it('proves real WS2025 baseline triggers file mode (the original bug)', async () => {
    const { readFile } = await import('fs/promises');
    const path = await import('path');
    const baseline = await readFile(
      path.join(__dirname, '..', '..', '..', '..', 'public', '_baselines', 'ws2025-member-server.osc.yaml'),
      'utf8',
    );
    // Sanity: this is the file size we measured causing ENAMETOOLONG.
    expect(Buffer.byteLength(baseline, 'utf8')).toBeGreaterThan(50_000);
    const p = planApply({ content: baseline, namespace: 'ws2025-member-server' });
    expect(p.mode).toBe('file');
  });
});

describe('applyManifest — caller file normalization', () => {
  it('normalizes a temporary copy without overwriting the source file and cleans it up', async () => {
    const testDir = await mkdtemp(path.join(tmpdir(), 'configforge-apply-test-'));
    const sourceFile = path.join(testDir, 'source.osc.yaml');
    const source = `resources:
  - name: registry
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKEY_LOCAL_MACHINE\\Software\\FileInput
      valueName: Enabled
      valueType: REG_DWORD
      value: 1
`;
    await writeFile(sourceFile, source, 'utf8');
    let appliedFile = '';
    let appliedContent = '';
    runOscfgMock.mockImplementation(async (args) => {
      appliedFile = args[args.indexOf('-f') + 1];
      appliedContent = await readFile(appliedFile, 'utf8');
      return {
        success: true,
        data: '',
        error: null,
        exitCode: 0,
        stdout: '',
        stderr: '',
      };
    });

    try {
      const result = await applyManifest({ file: sourceFile, namespace: 'file-input' });

      expect(result.success).toBe(true);
      expect(appliedFile).not.toBe(sourceFile);
      const parsed = yaml.load(appliedContent) as {
        resources: Array<{ properties: { keyPath: string; valueType: string } }>;
      };
      expect(parsed.resources[0].properties.keyPath).toBe(
        'HKEY_LOCAL_MACHINE:\\Software\\FileInput',
      );
      expect(parsed.resources[0].properties.valueType).toBe('REG_DWORD');
      expect(await readFile(sourceFile, 'utf8')).toBe(source);
      await expect(access(appliedFile)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });
});
