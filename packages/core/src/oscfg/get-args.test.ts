// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Regression tests for the `--` argv separator added to `getResources`
 * (oscfg/get.ts) and `deleteResource` (oscfg/manage.ts).
 *
 * Without the separator, a positional NAME beginning with `-` (e.g.
 * `-h`, `--version`) is parsed as a flag by oscfg's clap-based CLI:
 *
 *   oscfg get resource -h --output json
 *   ↑ clap sees `-h` and prints help; the actual NAME never reaches the
 *     resource lookup. The wrapper then "succeeds" with an empty array.
 *
 * We assert the separator lands at the right index for both surfaces.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./runner', () => ({
  runOscfg: vi.fn(async () => ({ success: true, data: [] })),
}));

import { runOscfg } from './runner';
import { getResources } from './get';
import { deleteResource } from './manage';

const mockedRun = runOscfg as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedRun.mockClear();
  mockedRun.mockResolvedValue({ success: true, data: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('getResources — argv `--` separator before positional NAME', () => {
  it('inserts `--` before a name that starts with `-` (was parsed as -h flag)', async () => {
    await getResources({ name: '-h' });

    expect(mockedRun).toHaveBeenCalledTimes(1);
    const args = mockedRun.mock.calls[0][0] as string[];
    const sepIdx = args.indexOf('--');
    expect(sepIdx).toBeGreaterThan(-1);
    // The NAME must come AFTER the separator so clap stops flag-parsing.
    expect(args[sepIdx + 1]).toBe('-h');
  });

  it('inserts `--` before a name that starts with `--` (was parsed as long flag)', async () => {
    await getResources({ name: '--version' });

    const args = mockedRun.mock.calls[0][0] as string[];
    const sepIdx = args.indexOf('--');
    expect(args[sepIdx + 1]).toBe('--version');
  });

  it('still inserts `--` for ordinary names (defense in depth, no behavior change for clap)', async () => {
    await getResources({ name: 'PasswordPolicy' });

    const args = mockedRun.mock.calls[0][0] as string[];
    const sepIdx = args.indexOf('--');
    expect(sepIdx).toBeGreaterThan(-1);
    expect(args[sepIdx + 1]).toBe('PasswordPolicy');
  });

  it('omits the separator entirely when no name is supplied (list-all path)', async () => {
    await getResources({});

    const args = mockedRun.mock.calls[0][0] as string[];
    expect(args).not.toContain('--');
    expect(args).toEqual(['get', 'resource', '--output', 'json']);
  });

  it('keeps -n / --output flags after the separator (does not break namespace scoping)', async () => {
    await getResources({ name: '-h', namespace: 'secbase1' });

    const args = mockedRun.mock.calls[0][0] as string[];
    const sepIdx = args.indexOf('--');
    expect(args[sepIdx + 1]).toBe('-h');
    // -n must follow the positional, not be consumed by it.
    expect(args).toContain('-n');
    expect(args[args.indexOf('-n') + 1]).toBe('secbase1');
  });
});

describe('deleteResource — argv `--` separator before positional NAME', () => {
  it('inserts `--` before a name that starts with `-`', async () => {
    await deleteResource({ name: '-h' });

    expect(mockedRun).toHaveBeenCalledTimes(1);
    const args = mockedRun.mock.calls[0][0] as string[];
    const sepIdx = args.indexOf('--');
    expect(sepIdx).toBeGreaterThan(-1);
    expect(args[sepIdx + 1]).toBe('-h');
  });

  it('still passes -n after the separator + positional', async () => {
    await deleteResource({ name: 'r1', namespace: 'ns1' });

    const args = mockedRun.mock.calls[0][0] as string[];
    expect(args).toEqual(['delete', 'resource', '--', 'r1', '-n', 'ns1']);
  });
});
