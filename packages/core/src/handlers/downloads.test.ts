// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Tests for the streamed-download handlers.
 *
 * audit-pack and export and matrix-xlsx all share the
 * `{ filename, contentType, body }` shape.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../oscfg', () => ({
  getRegistration: vi.fn(),
  getRegistrationSource: vi.fn(),
  getResources: vi.fn(),
  resourcesToYaml: vi.fn(),
  parseYamlDocument: vi.fn((s: string) => {
    if (!s) return {};
    if (s.includes('resources:')) return { resources: [] };
    return {};
  }),
  sanitizeNamespace: vi.fn((s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, '-')),
}));

vi.mock('../history', () => ({
  getHistory: vi.fn().mockResolvedValue([]),
}));

vi.mock('../cis/compliance', () => ({
  computeCompliance: vi.fn().mockResolvedValue({ summary: { score: 100 } }),
}));

vi.mock('../audit-pack', () => ({
  buildAuditPack: vi.fn(),
}));

vi.mock('../audit-pack/markdown', () => ({
  buildAuditPackMarkdown: vi.fn(() => '# Audit Pack\n\nGenerated.\n'),
}));

vi.mock('../audit-pack/rationale-loader', () => ({
  tryLoadRationale: vi.fn().mockResolvedValue([]),
}));

vi.mock('../runtime/paths', () => ({
  resolvePublicAsset: vi.fn((p: string) => `/tmp/public/${p}`),
}));

vi.mock('../diff/matrix', () => ({
  buildMatrix: vi.fn((manifests: unknown[]) =>
    manifests.length >= 2
      ? [
          {
            type: 't',
            name: 'r1',
            keyPath: '',
            valueName: '',
            status: 'identical',
            values: { a: { status: 'identical', value: 1 }, b: { status: 'identical', value: 1 } },
          },
        ]
      : [],
  ),
}));

vi.mock('../diff/xlsx-builder', () => ({
  buildXlsx: vi.fn(() => Buffer.from('PK\x03\x04fake-xlsx')),
}));

vi.mock('../import-export', () => ({
  exportToYaml: vi.fn(() => 'resources: []\n'),
  exportToJson: vi.fn(() => '{"resources":[]}'),
  exportToMof: vi.fn(() => '/* MOF */'),
  exportToExcel: vi.fn(() => 'Name,Value\nfoo,bar\n'),
  exportToAzurePolicy: vi.fn(() => '{"policyDefinition":{}}'),
}));

import { buildAuditPackArtifact, contentDisposition } from './audit-pack';
import { buildMatrixXlsx, MATRIX_XLSX_MAX_BASELINES } from './matrix-xlsx';
import { exportManifest } from './export';
import { setBaselineCatalog } from './library';
import * as oscfg from '../oscfg';
import * as auditPackLib from '../audit-pack';
import { Readable } from 'node:stream';

const getRegistrationMock = vi.mocked(oscfg.getRegistration);
const getRegistrationSourceMock = vi.mocked(oscfg.getRegistrationSource);
const getResourcesMock = vi.mocked(oscfg.getResources);
const buildAuditPackMock = vi.mocked(auditPackLib.buildAuditPack);

beforeEach(() => {
  vi.clearAllMocks();
  setBaselineCatalog([]);
  getRegistrationMock.mockResolvedValue(null as never);
  getRegistrationSourceMock.mockResolvedValue(null as never);
  getResourcesMock.mockResolvedValue({ success: true, data: [], error: null, exitCode: 0 });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── contentDisposition ─────────────────────────────────────────────

describe('contentDisposition', () => {
  it('emits attachment + dual filename for ASCII', () => {
    const cd = contentDisposition('myfile.pdf');
    expect(cd).toMatch(/^attachment; filename="myfile\.pdf"; filename\*=UTF-8''myfile\.pdf$/);
  });

  it('strips non-ASCII for the filename= form, percent-encodes filename*=', () => {
    const cd = contentDisposition('résumé.pdf');
    expect(cd).toMatch(/filename="r_sum_\.pdf"/);
    expect(cd).toContain('filename*=UTF-8');
  });

  it('respects inline disposition', () => {
    const cd = contentDisposition('x.pdf', 'inline');
    expect(cd.startsWith('inline;')).toBe(true);
  });
});

// ─── audit-pack ─────────────────────────────────────────────────────

describe('buildAuditPackArtifact', () => {
  it('rejects empty id', async () => {
    await expect(buildAuditPackArtifact({ id: '' })).rejects.toMatchObject({ status: 400 });
  });

  it('rejects unknown format', async () => {
    await expect(
      buildAuditPackArtifact({ id: 'x', format: 'docx' as never }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/format must be/) });
  });

  it('returns 404 when manifest not registered', async () => {
    await expect(buildAuditPackArtifact({ id: 'ghost' })).rejects.toMatchObject({
      status: 404,
      message: expect.stringMatching(/not registered/),
    });
  });

  it('builds markdown artifact', async () => {
    getRegistrationMock.mockResolvedValueOnce({
      namespace: 'mybase',
      displayName: 'mybase',
      platform: 'windows',
      registeredAt: '2026-01-01',
      source: 'user',
    } as never);

    const result = await buildAuditPackArtifact({ id: 'mybase', format: 'markdown' });
    expect(result.contentType).toMatch(/text\/markdown/);
    expect(result.body).toContain('# Audit Pack');
    expect(result.filename).toMatch(/\.md$/);
    expect(result.filename).toContain('mybase');
  });

  it('builds PDF artifact from pdfkit stream', async () => {
    getRegistrationMock.mockResolvedValueOnce({
      namespace: 'pdfbase',
      displayName: 'pdfbase',
      platform: 'windows',
      registeredAt: '2026-01-01',
      source: 'user',
    } as never);
    // Mock pdfkit to return a minimal Readable that emits %PDF- bytes.
    const fakeStream = Readable.from([Buffer.from('%PDF-1.7\n...binary...')]);
    buildAuditPackMock.mockReturnValueOnce(fakeStream as never);

    const result = await buildAuditPackArtifact({ id: 'pdfbase', format: 'pdf' });
    expect(result.contentType).toBe('application/pdf');
    expect(result.body).toBeInstanceOf(Uint8Array);
    const bytes = result.body as Uint8Array;
    expect(Buffer.from(bytes).toString('ascii').startsWith('%PDF-')).toBe(true);
    expect(result.filename).toMatch(/\.pdf$/);
  });

  it('respects inline disposition for the preview path', async () => {
    getRegistrationMock.mockResolvedValueOnce({
      namespace: 'p',
      displayName: 'p',
      platform: 'windows',
      registeredAt: '2026-01-01',
      source: 'user',
    } as never);
    buildAuditPackMock.mockReturnValueOnce(
      Readable.from([Buffer.from('%PDF-1.7')]) as never,
    );
    const result = await buildAuditPackArtifact({ id: 'p', disposition: 'inline' });
    expect(result.contentDisposition.startsWith('inline;')).toBe(true);
  });
});

// ─── matrix-xlsx ────────────────────────────────────────────────────

describe('buildMatrixXlsx', () => {
  it('rejects fewer than 2 distinct names', async () => {
    await expect(buildMatrixXlsx('only-one')).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/At least 2 distinct/),
    });
  });

  it('rejects more than the cap', async () => {
    const names = Array.from({ length: MATRIX_XLSX_MAX_BASELINES + 1 }, (_, i) => `m${i}`);
    await expect(buildMatrixXlsx(names.join(','))).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/At most/),
    });
  });

  it('rejects when fewer than 2 of the requested manifests exist', async () => {
    getRegistrationSourceMock.mockResolvedValue(null as never);
    await expect(buildMatrixXlsx('a,b')).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/Fewer than 2/),
    });
  });

  it('builds an xlsx artifact when two manifests are registered', async () => {
    getRegistrationSourceMock.mockResolvedValue('resources: []');
    const result = await buildMatrixXlsx('a,b');
    expect(result.contentType).toMatch(/spreadsheetml\.sheet/);
    expect(result.filename).toBe('matrix.xlsx');
    expect(result.body).toBeInstanceOf(Uint8Array);
    expect(result.body.byteLength).toBeGreaterThan(0);
  });

  it('dedups case-insensitively', async () => {
    getRegistrationSourceMock.mockResolvedValue('resources: []');
    // a, A, b → 2 distinct after dedup
    const result = await buildMatrixXlsx('a,A,b');
    expect(result).toBeDefined();
  });
});

// ─── export ─────────────────────────────────────────────────────────

describe('exportManifest', () => {
  it('rejects empty name', async () => {
    await expect(exportManifest({ name: '' })).rejects.toMatchObject({ status: 400 });
  });

  it('rejects unknown format', async () => {
    await expect(
      exportManifest({ name: 'x', format: 'badf' as never }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/Invalid format/),
    });
  });

  it('returns yaml from stored source when available', async () => {
    getRegistrationSourceMock.mockResolvedValueOnce('resources: []\n# source\n');
    const result = await exportManifest({ name: 'x', format: 'yaml' });
    expect(result.contentType).toMatch(/yaml/);
    expect(result.body).toContain('# source');
    expect(result.cacheable).toBe(true);
    expect(result.filename).toBe('x.osc.yaml');
  });

  it('falls back to live resources when no stored source', async () => {
    getRegistrationSourceMock.mockResolvedValueOnce(null as never);
    getResourcesMock.mockResolvedValueOnce({
      success: true,
      data: [{ name: 'r', type: 't', properties: {} }],
      error: null,
      exitCode: 0,
    });
    vi.mocked(oscfg.resourcesToYaml).mockReturnValueOnce('resources:\n  - name: r\n');
    const result = await exportManifest({ name: 'y', format: 'yaml' });
    expect(result.body).toContain('resources:');
    expect(result.cacheable).toBe(false);
  });

  it('builds JSON canonical export', async () => {
    getRegistrationSourceMock.mockResolvedValueOnce('resources: []');
    const result = await exportManifest({ name: 'jx', format: 'json' });
    expect(result.contentType).toBe('application/json');
    expect(result.filename).toBe('jx.json');
  });

  it('builds MOF', async () => {
    getRegistrationSourceMock.mockResolvedValueOnce('resources: []');
    const result = await exportManifest({ name: 'mx', format: 'mof' });
    expect(result.contentType).toBe('text/plain');
    expect(result.filename).toBe('mx.mof');
  });

  it('builds Excel CSV', async () => {
    getRegistrationSourceMock.mockResolvedValueOnce('resources: []');
    const result = await exportManifest({ name: 'cx', format: 'excel' });
    expect(result.contentType).toBe('text/csv');
    expect(result.filename).toBe('cx.csv');
  });

  it('builds Azure Policy JSON without needing source YAML', async () => {
    getRegistrationSourceMock.mockResolvedValueOnce(null as never);
    const result = await exportManifest({ name: 'ap', format: 'azurepolicy' });
    expect(result.contentType).toBe('application/json');
    expect(result.filename).toBe('ap.policy.json');
  });

  it('passes effect through to azurepolicy export', async () => {
    const result = await exportManifest({
      name: 'ap',
      format: 'azurepolicy',
      effect: 'DeployIfNotExists',
    });
    expect(result.body).toBeDefined();
  });

  // ── Azure Policy export — safety guards (added with the Azure Policy
  //    GC baseline import support). These lock in the user-facing
  //    contract: 1) placeholder-baseline manifests can't silently
  //    produce a fake-compliance policy, and 2) the OS family used in
  //    the policy targeting comes from the manifest's own resources
  //    rather than a hardcoded default. ──
  it('refuses to export a placeholder-baseline manifest as Azure Policy', async () => {
    // Manifest contains an imported Microsoft.OSConfig/BaselineRule
    // placeholder (the rule identity without an implementation).
    // Exporting this as Azure Policy would produce a MOF that the
    // OSConfig agent silently skips, which Azure then reports as
    // Compliant for every VM. Must fail loudly instead.
    getRegistrationSourceMock.mockResolvedValueOnce(
      'resources:\n  - name: rule1\n    type: Microsoft.OSConfig/BaselineRule\n    properties:\n      ruleId: abc-123\n' as never,
    );
    // The mocked parseYamlDocument in this file only returns an empty
    // resources array, so swap it out for this test to recognise the
    // baseline-rule shape.
    const oscfgMock = vi.mocked(oscfg.parseYamlDocument);
    oscfgMock.mockReturnValueOnce({
      resources: [
        { name: 'rule1', type: 'Microsoft.OSConfig/BaselineRule', properties: { ruleId: 'abc-123' } },
      ],
    } as never);
    await expect(
      exportManifest({ name: 'placeholder-baseline', format: 'azurepolicy' }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/placeholder baseline rule/i),
    });
  });

  it('refuses placeholder-baseline export even with DeployIfNotExists', async () => {
    // Same guard fires regardless of effect — the placeholder issue
    // is in the MOF, not the policy effect parameter.
    getRegistrationSourceMock.mockResolvedValueOnce('resources: []\n' as never);
    const oscfgMock = vi.mocked(oscfg.parseYamlDocument);
    oscfgMock.mockReturnValueOnce({
      resources: [
        { name: 'r1', type: 'Microsoft.OSConfig/BaselineRule', properties: {} },
        { name: 'r2', type: 'Microsoft.OSConfig/BaselineRule', properties: {} },
      ],
    } as never);
    await expect(
      exportManifest({
        name: 'p',
        format: 'azurepolicy',
        effect: 'DeployIfNotExists',
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/2 placeholder baseline rule/i),
    });
  });

  it('rejects manifests that mix Windows and Linux resources', async () => {
    // Should be impossible in normal authoring (a GC MOF can only
    // target one OS), but if it happens we surface it clearly instead
    // of silently picking one OS and shipping a broken policy.
    getRegistrationSourceMock.mockResolvedValueOnce('resources: []\n' as never);
    const oscfgMock = vi.mocked(oscfg.parseYamlDocument);
    oscfgMock.mockReturnValueOnce({
      resources: [
        { name: 'r1', type: 'Microsoft.Windows/Registry', properties: {} },
        { name: 'r2', type: 'Microsoft.OSConfig/FileLine', properties: {} },
      ],
    } as never);
    await expect(
      exportManifest({ name: 'mixed', format: 'azurepolicy' }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/both Windows and Linux/i),
    });
  });

  it('accepts an explicit osType override for azurepolicy export', async () => {
    // The handler exposes osType on ExportRequest so callers (UI) can
    // force a target even when the manifest is empty or ambiguous.
    getRegistrationSourceMock.mockResolvedValueOnce(null as never);
    const result = await exportManifest({
      name: 'override',
      format: 'azurepolicy',
      osType: 'Linux',
    });
    expect(result.contentType).toBe('application/json');
    expect(result.filename).toBe('override.policy.json');
  });
});
