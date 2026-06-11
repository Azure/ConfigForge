// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRationalePrompt } from './use-rationale-prompt';

/**
 * v0.1.1 regression guard: the rationale append IPC must receive a
 * FLAT request shape (`{id, resourceName, oldValue, newValue, reason,
 * skipped}`), not the previously-shipped wrapped shape
 * (`{id, entry: {...}}`).
 *
 * The handler in `packages/core/src/handlers/rationale-write.ts`
 * validates `req.resourceName` directly. Passing the wrapped shape
 * caused `resourceName must be a non-empty string` to bubble up to
 * the modal — breaking BOTH "Save & continue" and "Skip" paths
 * (the loop bailed out before `onSave()` could run, so the user
 * couldn't even bypass the rationale prompt). Reported on v0.1.0
 * Azure DevBox install; this test locks in the fix.
 */
describe('useRationalePrompt — IPC shape regression', () => {
  beforeEach(() => {
    (window.cfs.rationale.append as ReturnType<typeof vi.fn>).mockReset();
    (window.cfs.rationale.append as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      entry: {},
    });
  });

  it('submitReason posts a FLAT request shape (no `entry` wrapper)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useRationalePrompt({ manifestId: 'cis-ws2022-ms', onSave }),
    );

    // Two YAMLs that differ in one resource so the modal opens.
    const before = 'resources:\n  - name: AccountLockoutThreshold\n    valueData: 5\n';
    const after = 'resources:\n  - name: AccountLockoutThreshold\n    valueData: 10\n';

    await act(async () => {
      await result.current.requestSave(before, after);
    });

    // Modal opens with one diff. submitReason fires the IPC.
    await act(async () => {
      await result.current.submitReason('Tightening per security team request');
    });

    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });

    expect(window.cfs.rationale.append).toHaveBeenCalledTimes(1);
    const arg = (window.cfs.rationale.append as ReturnType<typeof vi.fn>).mock
      .calls[0][0];

    // CRITICAL — the v0.1.0 bug shipped `{id, entry: {...}}`. The handler
    // validates `req.resourceName` directly, so the wrapped shape failed
    // with "resourceName must be a non-empty string". Lock in the FLAT
    // shape going forward.
    expect(arg).not.toHaveProperty('entry');
    expect(arg).toMatchObject({
      id: 'cis-ws2022-ms',
      resourceName: 'AccountLockoutThreshold',
      reason: 'Tightening per security team request',
      skipped: false,
    });
    expect(typeof arg.resourceName).toBe('string');
    expect(arg.resourceName.length).toBeGreaterThan(0);
  });

  it('skip path also posts a FLAT request shape (so users can bypass)', async () => {
    // The v0.1.0 bug broke Skip too — the loop threw before onSave ran,
    // so even users who didn't want to write a reason were stuck.
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useRationalePrompt({ manifestId: 'cis-ws2022-ms', onSave }),
    );

    const before = 'resources:\n  - name: PasswordLength\n    valueData: 8\n';
    const after = 'resources:\n  - name: PasswordLength\n    valueData: 14\n';

    await act(async () => {
      await result.current.requestSave(before, after);
    });
    await act(async () => {
      await result.current.skip();
    });

    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });
    const arg = (window.cfs.rationale.append as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(arg).not.toHaveProperty('entry');
    expect(arg).toMatchObject({
      id: 'cis-ws2022-ms',
      resourceName: 'PasswordLength',
      skipped: true,
    });
  });
});

/**
 * v0.1.1 audit-integrity guard: rationale append must NOT be persisted
 * when the manifest save fails. The previous implementation appended
 * rationale entries first, then called onSave(); if onSave() failed,
 * the JSONL log permanently contained an entry describing a change
 * that never landed on disk. Auditors reading the log would see
 * fictitious changes.
 */
describe('useRationalePrompt — audit-log integrity (save-then-rationale order)', () => {
  beforeEach(() => {
    (window.cfs.rationale.append as ReturnType<typeof vi.fn>).mockReset();
    (window.cfs.rationale.append as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      entry: {},
    });
  });

  it('does NOT append rationale when onSave throws', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Conflict — manifest changed on disk'));
    const { result } = renderHook(() =>
      useRationalePrompt({ manifestId: 'cis-ws2022-ms', onSave }),
    );

    const before = 'resources:\n  - name: A\n    valueData: 1\n';
    const after = 'resources:\n  - name: A\n    valueData: 2\n';

    await act(async () => {
      await result.current.requestSave(before, after);
    });
    await act(async () => {
      await result.current.submitReason('legitimate change');
    });

    // Save was attempted...
    expect(onSave).toHaveBeenCalled();
    // ...but the rationale store was never written to.
    expect(window.cfs.rationale.append).not.toHaveBeenCalled();
    // Modal stays open with the error so the user can retry.
    expect(result.current.state.error).toMatch(/Conflict/i);
  });

  it('appends rationale ONLY after onSave resolves', async () => {
    const callOrder: string[] = [];
    const onSave = vi.fn().mockImplementation(async () => {
      callOrder.push('save');
    });
    (window.cfs.rationale.append as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push('rationale');
      return { ok: true, entry: {} };
    });

    const { result } = renderHook(() =>
      useRationalePrompt({ manifestId: 'cis-ws2022-ms', onSave }),
    );
    const before = 'resources:\n  - name: A\n    valueData: 1\n';
    const after = 'resources:\n  - name: A\n    valueData: 2\n';

    await act(async () => {
      await result.current.requestSave(before, after);
    });
    await act(async () => {
      await result.current.submitReason('reason');
    });

    expect(callOrder).toEqual(['save', 'rationale']);
  });

  it('surfaces a partial-failure warning when save succeeds but rationale append fails', async () => {
    // Audit-integrity tradeoff: if the save committed but rationale
    // append failed, we do NOT roll back the save. Losing the user's
    // edits to preserve a metadata log would be the worse failure
    // mode. Instead we surface a warning so the user can back-fill.
    const onSave = vi.fn().mockResolvedValue(undefined);
    (window.cfs.rationale.append as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('rationale store locked'),
    );

    const { result } = renderHook(() =>
      useRationalePrompt({ manifestId: 'cis-ws2022-ms', onSave }),
    );
    const before = 'resources:\n  - name: A\n    valueData: 1\n';
    const after = 'resources:\n  - name: A\n    valueData: 2\n';

    await act(async () => {
      await result.current.requestSave(before, after);
    });
    await act(async () => {
      await result.current.submitReason('reason');
    });

    expect(onSave).toHaveBeenCalled();
    expect(window.cfs.rationale.append).toHaveBeenCalled();
    expect(result.current.state.error).toMatch(/Saved.*rationale.*failed/i);
  });
});
