// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Phase B.3 — unit tests for `useDocsModal`.
 *
 * Locks in the v0.1.11 copy-timer cleanup contract before the visual
 * extraction (Phase C) moves the docs modal into a sub-component.
 * Critical invariants:
 *   - The "Copied!" toast auto-resets after 2 s
 *   - The reset timer is cleared on unmount (no late setState on a
 *     torn-down component)
 *   - handleGenerateDocs opens the modal and updates content state
 *     even when the IPC fails (so the user sees the error inline)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDocsModal } from './useDocsModal';

function installDocsStub(overrides?: { generate?: ReturnType<typeof vi.fn> }) {
  const generate = overrides?.generate ?? vi.fn();
  if (!overrides?.generate) {
    generate.mockResolvedValue({
      markdown: '# Sample\n',
      filename: 'sample.md',
    });
  }
  Object.assign(window.cfs as Record<string, unknown>, {
    docs: { generate, get: vi.fn() },
  });
  return { generate };
}

beforeEach(() => {
  delete (window.cfs as Record<string, unknown>).docs;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

afterEach(() => {
  delete (window.cfs as Record<string, unknown>).docs;
  vi.useRealTimers();
});

// ── Happy-path generate ────────────────────────────────────────────

describe('useDocsModal — handleGenerateDocs', () => {
  it('opens the modal and populates markdown + filename on success', async () => {
    const { generate } = installDocsStub();
    const { result } = renderHook(() => useDocsModal('sample'));

    await act(async () => {
      await result.current.handleGenerateDocs('resources: []\n');
    });

    expect(generate).toHaveBeenCalledWith({
      name: 'sample',
      content: 'resources: []\n',
    });
    expect(result.current.docsOpen).toBe(true);
    expect(result.current.docsMarkdown).toBe('# Sample\n');
    expect(result.current.docsFilename).toBe('sample.md');
    expect(result.current.docsLoading).toBe(false);
  });

  it('surfaces an error message inside the modal when generate rejects', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('docs IPC down'));
    installDocsStub({ generate });

    const { result } = renderHook(() => useDocsModal('sample'));
    await act(async () => {
      await result.current.handleGenerateDocs('resources: []\n');
    });

    expect(result.current.docsOpen).toBe(true);
    expect(result.current.docsMarkdown).toMatch(/docs IPC down/);
    expect(result.current.docsFilename).toBe('sample.md');
    expect(result.current.docsLoading).toBe(false);
  });

  it('resets the copied flag on each new generate call', async () => {
    installDocsStub();
    const { result } = renderHook(() => useDocsModal('sample'));

    await act(async () => {
      await result.current.handleGenerateDocs('a');
    });

    // Manually flip docsCopied via copy
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    await act(async () => {
      await result.current.handleDocsCopy();
    });
    expect(result.current.docsCopied).toBe(true);

    await act(async () => {
      await result.current.handleGenerateDocs('b');
    });
    expect(result.current.docsCopied).toBe(false);
  });
});

// ── Copy + 2s reset timer (v0.1.11) ────────────────────────────────

describe('useDocsModal — copy timer (v0.1.11)', () => {
  it('sets docsCopied=true on copy and resets to false after 2 seconds', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    installDocsStub();

    const { result } = renderHook(() => useDocsModal('sample'));
    await act(async () => {
      await result.current.handleGenerateDocs('source');
    });

    await act(async () => {
      await result.current.handleDocsCopy();
    });

    expect(result.current.docsCopied).toBe(true);
    expect(result.current.docsCopiedTimerRef.current).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.docsCopied).toBe(false);
    expect(result.current.docsCopiedTimerRef.current).toBeNull();
  });

  it('clears the reset timer on unmount so no late setState fires', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    installDocsStub();

    const { result, unmount } = renderHook(() => useDocsModal('sample'));
    await act(async () => {
      await result.current.handleGenerateDocs('source');
    });
    await act(async () => {
      await result.current.handleDocsCopy();
    });

    expect(result.current.docsCopiedTimerRef.current).not.toBeNull();

    unmount();

    // Spy on console to ensure no React warning about setState on
    // unmounted component fires when the timer would have run.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('back-to-back copies reset the timer instead of stacking', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    installDocsStub();

    const { result } = renderHook(() => useDocsModal('sample'));
    await act(async () => {
      await result.current.handleGenerateDocs('source');
    });
    await act(async () => {
      await result.current.handleDocsCopy();
    });

    // 1s later — copy again. The first timer should be cleared and
    // replaced; total wait is now 2s from the second copy, not 2s
    // from the first.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.docsCopied).toBe(true);

    await act(async () => {
      await result.current.handleDocsCopy();
    });
    expect(result.current.docsCopied).toBe(true);

    // 1.5s more from the SECOND copy: should still be true (less than 2s)
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.docsCopied).toBe(true);

    // Another 0.5s later (2s after second copy total): should flip to false
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.docsCopied).toBe(false);
  });
});

// ── Download ───────────────────────────────────────────────────────

describe('useDocsModal — handleDocsDownload', () => {
  it('triggers a Blob download with the right filename', async () => {
    installDocsStub();
    const createObjectURL = vi.fn().mockReturnValue('blob:mock');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(window.URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });

    const { result } = renderHook(() => useDocsModal('sample'));
    await act(async () => {
      await result.current.handleGenerateDocs('source');
    });

    // Spy on anchor click so we don't actually download a file in
    // the test environment.
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    act(() => {
      result.current.handleDocsDownload();
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });
});
