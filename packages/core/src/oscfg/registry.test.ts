// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * PR18: tests for atomic registration writes.
 *
 * Pre-PR18, `saveRegistration` performed two non-atomic `writeFile` calls
 * back to back. A crash between them, or two concurrent callers for the
 * same namespace, could leave the .json metadata and .source.yaml file
 * out of sync — causing audit/deploy/revert to read mismatched data.
 *
 * PR18 protocol:
 *   1. Each file written via temp + rename (atomic on same volume).
 *   2. Order: yaml first, json last (json is the commit marker).
 *   3. Per-namespace mutex serializes concurrent writers in-process.
 *   4. CONFIGFORGE_HOME env var now relocates the registry root (matches
 *      the convention used by history/snapshots and makes the module
 *      testable in a sandbox).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
  deleteRegistration,
  getRegistration,
  getRegistrationSource,
  listRegistrations,
  saveRegistration,
  updateRegistration,
  type ManifestRegistration,
} from './registry';

let SANDBOX = '';

function makeReg(
  namespace: string,
  overrides: Partial<ManifestRegistration> = {},
): ManifestRegistration {
  return {
    namespace,
    displayName: namespace,
    platform: 'windows',
    registeredAt: new Date().toISOString(),
    source: 'user',
    ...overrides,
  };
}

beforeEach(async () => {
  SANDBOX = await mkdtemp(path.join(tmpdir(), 'cf-registry-'));
  process.env.CONFIGFORGE_HOME = SANDBOX;
});

afterEach(async () => {
  delete process.env.CONFIGFORGE_HOME;
  await rm(SANDBOX, { recursive: true, force: true });
});

describe('saveRegistration (PR18 atomic)', () => {
  it('honors CONFIGFORGE_HOME (writes under sandbox, not ~/.configforge)', async () => {
    const reg = makeReg('test-ns');
    await saveRegistration(reg, 'resources: []');
    const manifestsDir = path.join(SANDBOX, 'manifests');
    const files = await readdir(manifestsDir);
    expect(files).toEqual(expect.arrayContaining(['test-ns.json', 'test-ns.source.yaml']));
  });

  it('round-trips a registration through save/get', async () => {
    const reg = makeReg('round-trip');
    await saveRegistration(reg, 'resources: []');
    const got = await getRegistration('round-trip');
    expect(got).toEqual(reg);
    const src = await getRegistrationSource('round-trip');
    expect(src).toBe('resources: []');
  });

  it('overwrite of an existing registration leaves both files in lockstep', async () => {
    const v1 = makeReg('drift', { displayName: 'v1' });
    await saveRegistration(v1, 'version: 1');
    const v2 = makeReg('drift', { displayName: 'v2' });
    await saveRegistration(v2, 'version: 2');

    const got = await getRegistration('drift');
    const src = await getRegistrationSource('drift');
    expect(got?.displayName).toBe('v2');
    expect(src).toBe('version: 2');
  });

  it('does not leave .tmp files behind on a successful write', async () => {
    await saveRegistration(makeReg('clean'), 'resources: []');
    const files = await readdir(path.join(SANDBOX, 'manifests'));
    expect(files.filter((f) => f.includes('.tmp'))).toEqual([]);
  });

  it('listRegistrations ignores .tmp leftovers from a prior crash', async () => {
    // Simulate a crashed write: a stale .json.<rand>.tmp left in the dir.
    await saveRegistration(makeReg('alive'), 'resources: []');
    const manifestsDir = path.join(SANDBOX, 'manifests');
    await writeFile(
      path.join(manifestsDir, 'ghost.json.12345.abcdef.tmp'),
      '{"namespace":"ghost"}',
      'utf-8',
    );
    const list = await listRegistrations();
    expect(list.map((r) => r.namespace).sort()).toEqual(['alive']);
  });

  it('deleteRegistration removes both files', async () => {
    await saveRegistration(makeReg('to-delete'), 'resources: []');
    await deleteRegistration('to-delete');
    expect(await getRegistration('to-delete')).toBeNull();
    expect(await getRegistrationSource('to-delete')).toBeNull();
  });
});

describe('saveRegistration concurrency (PR18 mutex)', () => {
  it('serializes concurrent writes for the same namespace — last one wins, no corruption', async () => {
    // Fire 10 concurrent saves for the same namespace, each with a
    // distinct displayName + yaml. The mutex should serialize them so
    // SOME individual writer's metadata wins entirely (lockstep with
    // its yaml). Pre-PR18 this could interleave: writer A's json +
    // writer B's yaml.
    const writes = Array.from({ length: 10 }, (_, i) =>
      saveRegistration(
        makeReg('race', { displayName: `writer-${i}` }),
        `# writer ${i}\nresources: []\n`,
      ),
    );
    await Promise.all(writes);

    const json = await getRegistration('race');
    const yaml = await getRegistrationSource('race');
    expect(json).not.toBeNull();
    expect(yaml).not.toBeNull();
    // Whichever writer landed last, its json's displayName must match
    // the writer index in its yaml. They MUST be from the same writer.
    const m = /writer-(\d+)/.exec(json!.displayName);
    expect(m).not.toBeNull();
    expect(yaml).toContain(`# writer ${m![1]}`);
  });

  it('does NOT serialize across different namespaces (parallelism preserved)', async () => {
    // Different namespaces should not block each other. We can't easily
    // assert timing, but we can assert correctness under concurrency.
    const writes = Array.from({ length: 8 }, (_, i) =>
      saveRegistration(
        makeReg(`ns-${i}`, { displayName: `n${i}` }),
        `value: ${i}`,
      ),
    );
    await Promise.all(writes);
    const list = await listRegistrations();
    expect(list).toHaveLength(8);
    for (let i = 0; i < 8; i++) {
      const r = list.find((x) => x.namespace === `ns-${i}`);
      expect(r?.displayName).toBe(`n${i}`);
      expect(await getRegistrationSource(`ns-${i}`)).toBe(`value: ${i}`);
    }
  });
});

describe('updateRegistration (PR18 atomic)', () => {
  it('atomically patches the .json without touching .source.yaml', async () => {
    await saveRegistration(makeReg('patch-me'), 'original yaml');
    const updated = await updateRegistration('patch-me', { lastAuditedAt: '2026-04-28T00:00:00Z' });
    expect(updated?.lastAuditedAt).toBe('2026-04-28T00:00:00Z');
    expect(updated?.namespace).toBe('patch-me');
    // Yaml is untouched
    expect(await getRegistrationSource('patch-me')).toBe('original yaml');
    // Read-back matches
    const got = await getRegistration('patch-me');
    expect(got?.lastAuditedAt).toBe('2026-04-28T00:00:00Z');
  });

  it('returns null for unknown namespace without writing any file', async () => {
    const got = await updateRegistration('does-not-exist', { lastAppliedAt: 'x' });
    expect(got).toBeNull();
    // Nothing written
    const list = await listRegistrations();
    expect(list).toHaveLength(0);
  });

  it('serializes concurrent updates (last write wins, no torn json)', async () => {
    await saveRegistration(makeReg('update-race'), 'yaml');
    // 20 concurrent updates each setting a distinct timestamp.
    const updates = Array.from({ length: 20 }, (_, i) =>
      updateRegistration('update-race', { lastAuditedAt: `2026-04-${String(i + 1).padStart(2, '0')}T00:00:00Z` }),
    );
    await Promise.all(updates);
    // The final on-disk json must be parseable (no torn write) and must
    // be one of the 20 timestamps we wrote.
    const got = await getRegistration('update-race');
    expect(got).not.toBeNull();
    expect(got!.lastAuditedAt).toMatch(/^2026-04-\d{2}T00:00:00Z$/);
    // And the file must round-trip as valid JSON when read raw.
    const raw = await readFile(path.join(SANDBOX, 'manifests', 'update-race.json'), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
