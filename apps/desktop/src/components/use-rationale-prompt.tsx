// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.


/**
 * PR27: Rationale-prompt hook + modal.
 *
 * The hook wraps an existing async save handler with a "Why this change?"
 * modal. Behavior contract:
 *
 *   - First call to `requestSave(beforeYaml, afterYaml)`:
 *       - If the manifests are structurally equal → call `onSave()`
 *         immediately. No modal.
 *       - Otherwise → show modal. User can:
 *           - "Save & continue" with a non-empty reason  → POST rationale,
 *             then call `onSave()`.
 *           - "Skip"                                      → POST rationale
 *             with skipped:true (and empty reason), then call `onSave()`.
 *           - "Cancel"                                    → modal closes;
 *             `onSave()` is NOT called.
 *
 *   - While a save is in flight (modal open OR onSave running) further
 *     `requestSave` calls are no-ops. This is the spec's "double-click"
 *     guard.
 *
 * Diff-detection logic lives in src/components/rationale-diff.ts so it
 * can be unit-tested without a DOM.
 */

import { useCallback, useState } from 'react';
import {
  WarningRegular,
  DismissRegular as CloseIcon,
} from "@fluentui/react-icons";
import { Button, Spinner } from "@fluentui/react-components";
import { cfs } from '../lib/cfs';
import {
  diffResources,
  shouldPromptForRationale,
  summarizeDiff,
  type ResourceDiff,
} from './rationale-diff';

const REASON_MAX_LEN = 500;

export interface UseRationalePromptOptions {
  /** Manifest namespace (decoded). Used as the URL segment for /api/manifests/[id]/rationale. */
  manifestId: string;
  /**
   * The `await`-able save you would normally have called when the user
   * clicked Save. Receives an optional `{author, rationale, changeSummary}`
   * so the caller can persist them in the snapshot itself if they want to.
   * `changeSummary` is the same string shown in the modal's "Changes:" chip
   * (e.g. "AccountLockoutThreshold modified") — surfaced in History so
   * the version list shows what changed.
   */
  onSave: (extra?: { rationale?: string; skipped?: boolean; changeSummary?: string }) => Promise<void> | void;
  /**
   * Optional override for the POST endpoint — default is
   * `/api/manifests/<id>/rationale`. Mostly here to make the hook
   * testable; production code shouldn't pass this.
   */
  postUrl?: (manifestId: string) => string;
}

export interface RationalePromptState {
  /** Show the modal? */
  open: boolean;
  /** Diffs the user is being asked to justify. */
  diffs: ResourceDiff[];
  /** True while we're awaiting POST + onSave. */
  busy: boolean;
  /** Last error from POST or onSave; null on success. */
  error: string | null;
}

export interface RationalePromptApi {
  state: RationalePromptState;
  /** Wrap your existing save click. Pass current+previous YAML. */
  requestSave: (beforeYaml: string, afterYaml: string) => Promise<void>;
  /** Modal callbacks — wire these to the modal buttons. */
  submitReason: (reason: string) => Promise<void>;
  skip: () => Promise<void>;
  cancel: () => void;
}

function _defaultPostUrl(id: string): string {
  return `/api/manifests/${encodeURIComponent(id)}/rationale`;
}

/**
 * Hook. The accompanying `<RationalePromptModal>` component below renders
 * `state` and wires the buttons to `submitReason` / `skip` / `cancel`.
 */
export function useRationalePrompt(opts: UseRationalePromptOptions): RationalePromptApi {
  const { manifestId, onSave } = opts;
  // postUrl was the legacy /api/...rationale fetch endpoint; keep the
  // option in the type for backward compat but the new IPC path goes
  // straight through cfs.rationale.append.
  void opts.postUrl;

  const [open, setOpen] = useState(false);
  const [diffs, setDiffs] = useState<ResourceDiff[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The latest pre-/post-edit yaml is captured here so the submit/skip
  // callbacks (which run in their own setState ticks) have stable inputs.
  const [pending, setPending] = useState<{ before: string; after: string } | null>(null);

  const reset = useCallback(() => {
    setOpen(false);
    setDiffs([]);
    setPending(null);
    setError(null);
    setBusy(false);
  }, []);

  const requestSave = useCallback(
    async (beforeYaml: string, afterYaml: string) => {
      // Guard against double-click while a save is in flight.
      if (busy || open) return;

      if (!shouldPromptForRationale(beforeYaml, afterYaml)) {
        setBusy(true);
        setError(null);
        try {
          await onSave();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          throw err;
        } finally {
          setBusy(false);
        }
        return;
      }

      setDiffs(diffResources(beforeYaml, afterYaml));
      setPending({ before: beforeYaml, after: afterYaml });
      setError(null);
      setOpen(true);
    },
    [busy, open, onSave],
  );

  const postRationaleAndSave = useCallback(
    async (reason: string, skipped: boolean) => {
      if (!pending) return;
      setBusy(true);
      setError(null);
      try {
        // v0.1.1 audit-integrity fix: save FIRST, rationale SECOND.
        //
        // The previous order — rationale-then-save — produced an
        // audit-log integrity violation. If `onSave()` failed (network
        // error, lock conflict, validation), the JSONL rationale store
        // would already contain entries describing changes that never
        // landed on disk. On retry, those entries duplicated. Auditors
        // reading the rationale log would see fictitious changes.
        //
        // Now: persist the manifest revision via `onSave()` first. If
        // that fails, we throw before any rationale is recorded — the
        // user re-attempts and only the successful save produces a log
        // entry.
        //
        // If the save succeeds but a rationale `append()` fails (rare
        // — the JSONL append is local fs only, no network), we log a
        // warning and continue. The manifest IS saved; the rationale
        // page lets the user back-fill an entry. We deliberately do
        // NOT roll back the save on rationale failure — losing the
        // user's edits to preserve a metadata log would be the worse
        // of the two failure modes.
        // PR (v0.3.47): include a short summary of the changes so the
        // History panel can show "AccountLockoutThreshold modified"
        // instead of the generic "Manifest registered". Same string as
        // the modal chip — single source of truth for both surfaces.
        const changeSummary = diffs.length > 0 ? summarizeDiff(diffs) : undefined;
        await onSave({ rationale: skipped ? '' : reason, skipped, ...(changeSummary ? { changeSummary } : {}) });

        const rationaleErrors: string[] = [];
        for (const diff of diffs) {
          try {
            await cfs.rationale.append({
              id: manifestId,
              resourceName: diff.resourceName,
              oldValue: diff.oldValue,
              newValue: diff.newValue,
              reason,
              skipped,
            });
          } catch (err) {
            // Save succeeded; surface but don't unwind.
            const msg = err instanceof Error ? err.message : String(err);
            rationaleErrors.push(`${diff.resourceName}: ${msg}`);
            // eslint-disable-next-line no-console
            console.warn(
              `[rationale] save committed but rationale append failed for "${diff.resourceName}":`,
              err,
            );
          }
        }

        if (rationaleErrors.length > 0) {
          // Surface the partial-failure to the user without blocking
          // the close — the save itself succeeded.
          setError(
            `Saved, but ${rationaleErrors.length} rationale ${
              rationaleErrors.length === 1 ? 'entry' : 'entries'
            } failed to record. You can add them later from the Rationale page.`,
          );
          setBusy(false);
          // Leave the modal open with a warning; user can dismiss via cancel.
          return;
        }

        reset();
      } catch (err) {
        // Save itself failed — no rationale was written, the user can
        // retry cleanly.
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
      }
    },
    [pending, diffs, manifestId, onSave, reset],
  );

  const submitReason = useCallback(
    async (reason: string) => {
      const trimmed = reason.trim();
      if (!trimmed) {
        setError('Please describe the change before saving, or click Skip.');
        return;
      }
      if (trimmed.length > REASON_MAX_LEN) {
        setError(`Rationale is too long (${trimmed.length}/${REASON_MAX_LEN} chars).`);
        return;
      }
      await postRationaleAndSave(reason, false);
    },
    [postRationaleAndSave],
  );

  const skip = useCallback(async () => {
    await postRationaleAndSave('', true);
  }, [postRationaleAndSave]);

  const cancel = useCallback(() => {
    if (busy) return; // can't cancel mid-POST
    reset();
  }, [busy, reset]);

  return {
    state: { open, diffs, busy, error },
    requestSave,
    submitReason,
    skip,
    cancel,
  };
}

// ── Modal component ─────────────────────────────────────────────────────────

export interface RationalePromptModalProps {
  state: RationalePromptState;
  submitReason: (reason: string) => Promise<void>;
  skip: () => Promise<void>;
  cancel: () => void;
}

/**
 * Headless-ish modal. Tailwind only — no extra deps.
 */
export function RationalePromptModal({
  state,
  submitReason,
  skip,
  cancel,
}: RationalePromptModalProps) {
  const [reason, setReason] = useState('');

  if (!state.open) return null;

  const charCount = reason.length;
  const overLimit = charCount > REASON_MAX_LEN;
  const trimmed = reason.trim();
  const canSubmit = !state.busy && !overLimit && trimmed.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rationale-modal-title"
    >
      <div className="mx-4 w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700">
          <h2
            id="rationale-modal-title"
            className="text-lg font-semibold text-slate-900 dark:text-white"
          >
            Why this change?
          </h2>
          <button
            onClick={cancel}
            disabled={state.busy}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            aria-label="Cancel and keep editing"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3 px-6 py-4">
          {state.diffs.length > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-700 dark:text-slate-300">Changes:</span>{' '}
              {summarizeDiff(state.diffs)}
            </p>
          )}
          <div>
            <textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Briefly explain the rationale for this change…"
              maxLength={REASON_MAX_LEN}
              disabled={state.busy}
              rows={4}
              className="w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-500"
            />
            <div className="mt-1 flex justify-between text-xs">
              <span className={overLimit ? 'text-red-500' : 'text-slate-400'}>
                {charCount} / {REASON_MAX_LEN}
              </span>
              {state.error && (
                <span className="flex items-center gap-1 text-red-500" role="alert">
                  <WarningRegular className="h-3 w-3" />
                  {state.error}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-3 dark:border-slate-700">
          <Button
            appearance="secondary"
            onClick={cancel}
            disabled={state.busy}
          >
            Cancel
          </Button>
          <Button
            appearance="secondary"
            onClick={() => {
              void skip();
            }}
            disabled={state.busy}
          >
            Skip
          </Button>
          <Button
            appearance="primary"
            onClick={() => {
              void submitReason(reason);
            }}
            disabled={!canSubmit}
            icon={state.busy ? <Spinner size="tiny" /> : undefined}
          >
            Save &amp; continue
          </Button>
        </div>
      </div>
    </div>
  );
}
