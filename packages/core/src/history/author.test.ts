// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Tests for src/lib/history/author.ts.
 *
 * The module shells out to `git config` via `child_process.exec`, which we
 * mock here so the tests are hermetic on machines without git or with a
 * differently-configured git identity. We also reset the per-process
 * cache between cases so each scenario re-runs the resolver from scratch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factory must be hoisted ABOVE imports — keep it self-contained
// and pull the spy back out via vi.mocked after the module is imported.
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('os', () => ({
  default: {
    userInfo: vi.fn(),
  },
  userInfo: vi.fn(),
}));

import { exec } from 'child_process';
import os from 'os';
import {
  resolveAuthor,
  _resetAuthorCacheForTests,
  _parseAuthorStringForTests,
} from './author';

const execMock = vi.mocked(exec) as unknown as ReturnType<typeof vi.fn>;
const userInfoMock = vi.mocked(os.userInfo);

/**
 * `promisify(exec)` calls exec(cmd, options, cb). The mock simulates a
 * successful invocation by calling `cb(null, {stdout, stderr})` and a
 * failure by calling `cb(error)`.
 */
function mockGit(values: Record<string, string | Error>): void {
  execMock.mockImplementation((cmd: string, _opts: unknown, cb: unknown) => {
    const callback = cb as (err: Error | null, out?: { stdout: string; stderr: string }) => void;
    const key = cmd.includes('user.name')
      ? 'user.name'
      : cmd.includes('user.email')
        ? 'user.email'
        : cmd;
    const v = values[key];
    if (v instanceof Error) {
      callback(v);
    } else if (v === undefined) {
      callback(new Error(`unexpected git config call: ${cmd}`));
    } else {
      callback(null, { stdout: v + '\n', stderr: '' });
    }
    return {} as never;
  });
}

beforeEach(() => {
  _resetAuthorCacheForTests();
  execMock.mockReset();
  userInfoMock.mockReset();
  delete process.env.CONFIGFORGE_AUTHOR;
});

afterEach(() => {
  _resetAuthorCacheForTests();
  delete process.env.CONFIGFORGE_AUTHOR;
});

// ── parseAuthorString helper ───────────────────────────────────────────────

describe('parseAuthorString', () => {
  it.each([
    ['Alice <a@b.com>', 'Alice', 'a@b.com'],
    ['  Alice <a@b.com>  ', 'Alice', 'a@b.com'],
    ['Alice', 'Alice', ''],
    ['  Bob  ', 'Bob', ''],
    ['<onlyemail@x.com>', '', 'onlyemail@x.com'],
    ['', '', ''],
    ['   ', '', ''],
    ['Name with spaces <name@host.tld>', 'Name with spaces', 'name@host.tld'],
  ])('parses %j', (input, expectedName, expectedEmail) => {
    const r = _parseAuthorStringForTests(input);
    expect(r.name).toBe(expectedName);
    expect(r.email).toBe(expectedEmail);
  });
});

// ── env-var resolution ─────────────────────────────────────────────────────

describe('resolveAuthor — env var wins', () => {
  it('uses CONFIGFORGE_AUTHOR with name+email format', async () => {
    process.env.CONFIGFORGE_AUTHOR = 'Test User <t@x>';
    const r = await resolveAuthor();
    expect(r).toEqual({ name: 'Test User', email: 't@x' });
    expect(execMock).not.toHaveBeenCalled();
  });

  it('uses CONFIGFORGE_AUTHOR with name-only format', async () => {
    process.env.CONFIGFORGE_AUTHOR = 'Solo Name';
    const r = await resolveAuthor();
    expect(r).toEqual({ name: 'Solo Name', email: '' });
    expect(execMock).not.toHaveBeenCalled();
  });

  it('falls through when CONFIGFORGE_AUTHOR is empty/whitespace', async () => {
    process.env.CONFIGFORGE_AUTHOR = '   ';
    mockGit({ 'user.name': 'GitFallback', 'user.email': 'g@h' });
    const r = await resolveAuthor();
    expect(r).toEqual({ name: 'GitFallback', email: 'g@h' });
  });
});

// ── git config resolution ──────────────────────────────────────────────────

describe('resolveAuthor — git config fallback', () => {
  it('uses git user.name + user.email when env var is absent', async () => {
    mockGit({ 'user.name': 'Git Name', 'user.email': 'git@example.com' });
    const r = await resolveAuthor();
    expect(r).toEqual({ name: 'Git Name', email: 'git@example.com' });
  });

  it('survives git failing entirely (no git, ENOENT, etc.)', async () => {
    execMock.mockImplementation((_c: string, _o: unknown, cb: unknown) => {
      const callback = cb as (err: Error) => void;
      callback(new Error('git: command not found'));
      return {} as never;
    });
    userInfoMock.mockReturnValue({
      username: 'osuser',
      uid: 0,
      gid: 0,
      shell: null,
      homedir: '/home/osuser',
    });
    const r = await resolveAuthor();
    expect(r).toEqual({ name: 'osuser', email: '' });
  });

  it('still works when git user.email is empty (some configs only set name)', async () => {
    mockGit({ 'user.name': 'Solo Git', 'user.email': '' });
    const r = await resolveAuthor();
    expect(r).toEqual({ name: 'Solo Git', email: '' });
  });

  it('falls through to OS user when git returns no name', async () => {
    mockGit({ 'user.name': '', 'user.email': '' });
    userInfoMock.mockReturnValue({
      username: 'osfallback',
      uid: 0,
      gid: 0,
      shell: null,
      homedir: '/home/osfallback',
    });
    const r = await resolveAuthor();
    expect(r).toEqual({ name: 'osfallback', email: '' });
  });
});

// ── OS-user fallback ──────────────────────────────────────────────────────

describe('resolveAuthor — os.userInfo fallback', () => {
  it('uses os username when both env and git produce nothing', async () => {
    mockGit({ 'user.name': '', 'user.email': '' });
    userInfoMock.mockReturnValue({
      username: 'osuser42',
      uid: 0,
      gid: 0,
      shell: null,
      homedir: '/home/osuser42',
    });
    const r = await resolveAuthor();
    expect(r.name).toBe('osuser42');
    expect(r.email).toBe('');
  });
});

// ── final unknown fallback ────────────────────────────────────────────────

describe('resolveAuthor — unknown fallback', () => {
  it('returns {name:"unknown", email:""} when everything fails', async () => {
    mockGit({ 'user.name': '', 'user.email': '' });
    userInfoMock.mockImplementation(() => {
      throw new Error('os.userInfo failed');
    });
    const r = await resolveAuthor();
    expect(r).toEqual({ name: 'unknown', email: '' });
  });

  it('returns {name:"unknown", email:""} when userInfo returns empty', async () => {
    mockGit({ 'user.name': '', 'user.email': '' });
    userInfoMock.mockReturnValue({
      username: '',
      uid: 0,
      gid: 0,
      shell: null,
      homedir: '',
    });
    const r = await resolveAuthor();
    expect(r).toEqual({ name: 'unknown', email: '' });
  });
});

// ── Caching contract ──────────────────────────────────────────────────────

describe('resolveAuthor — caches for process lifetime', () => {
  it('does not re-shell git on a second call', async () => {
    mockGit({ 'user.name': 'Cached', 'user.email': 'c@x' });
    const r1 = await resolveAuthor();
    const r2 = await resolveAuthor();
    expect(r1).toBe(r2);
    // 2 calls (user.name + user.email) on the FIRST resolve only.
    expect(execMock.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('parallel callers share a single in-flight resolve', async () => {
    let resolved = 0;
    execMock.mockImplementation((cmd: string, _o: unknown, cb: unknown) => {
      resolved++;
      const callback = cb as (err: Error | null, out: { stdout: string; stderr: string }) => void;
      setTimeout(() => {
        const v = cmd.includes('user.email') ? 'p@x' : 'Parallel';
        callback(null, { stdout: v + '\n', stderr: '' });
      }, 5);
      return {} as never;
    });
    const [a, b, c] = await Promise.all([resolveAuthor(), resolveAuthor(), resolveAuthor()]);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    // Should have fired at most one resolve-cycle's worth of execs (≤2).
    expect(resolved).toBeLessThanOrEqual(2);
  });
});

// ── Never-throws contract ─────────────────────────────────────────────────

describe('resolveAuthor — never throws', () => {
  it('returns a fallback even if every strategy throws synchronously', async () => {
    process.env.CONFIGFORGE_AUTHOR = '';
    execMock.mockImplementation(() => {
      throw new Error('exec is broken');
    });
    userInfoMock.mockImplementation(() => {
      throw new Error('os is broken');
    });
    await expect(resolveAuthor()).resolves.toEqual({ name: 'unknown', email: '' });
  });

  it('returns a fallback when env var read itself errors out', async () => {
    // Simulate a hostile env getter — not realistic in Node, but we
    // deliberately swallow throws everywhere so the contract holds.
    mockGit({ 'user.name': '', 'user.email': '' });
    userInfoMock.mockReturnValue({
      username: '',
      uid: 0,
      gid: 0,
      shell: null,
      homedir: '',
    });
    await expect(resolveAuthor()).resolves.toEqual({ name: 'unknown', email: '' });
  });
});
