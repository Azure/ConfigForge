// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { WarningRegular, ArrowSyncRegular } from "@fluentui/react-icons";
import { Button, MessageBar, MessageBarBody, Spinner } from "@fluentui/react-components";
import { detectConflicts, type Conflict } from "@configforge/core/ai/analyzer";
import { cfs } from "../lib/cfs";
import { useTranslation } from "react-i18next";

interface ConflictDetectorProps {
  manifestNames: string[];
}

export function ConflictDetector({ manifestNames }: ConflictDetectorProps) {
  const { t } = useTranslation("common");
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // v0.2.15: defense-in-depth. Even though the parent now memoizes
  // `manifestNames`, lock the effect to a *value*-stable key
  // (sorted CSV) so callers passing fresh array literals don't trigger
  // redundant N-fetch waves.
  const namesKey = useMemo(() => [...manifestNames].sort().join("|"), [manifestNames]);
  const namesRef = useRef(manifestNames);
  namesRef.current = manifestNames;

  const runDetection = useCallback(async () => {
    const names = namesRef.current;
    if (names.length < 2) {
      setConflicts([]);
      setChecked(true);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // v0.2.16: read the *source* YAML (what the user wrote when
      // registering), not the CLI-reported reconstructed YAML. The
      // latter is empty for registered-but-not-deployed manifests
      // and was the root cause of the conflict detector silently
      // missing real cross-manifest disagreements.
      const fetched = await Promise.all(
        names.map(async (name) => {
          try {
            const json = await cfs.manifests.getSource(name);
            const data = (json as { data?: string | null }).data;
            if (typeof data !== "string" || !data) return null;
            return { name, content: data };
          } catch {
            return null;
          }
        }),
      );

      const valid = fetched.filter((m): m is { name: string; content: string } => m !== null);

      const result = detectConflicts(valid);
      setConflicts(result.conflicts);
      setChecked(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check conflicts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (namesKey.split("|").filter(Boolean).length >= 2) {
      runDetection();
    }
  }, [namesKey, runDetection]);

  if (manifestNames.length < 2) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3 text-sm text-slate-400 dark:text-slate-500">
          <WarningRegular className="h-5 w-5" />
          {t("components.conflictDetector.extracted.text1")}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            {t("components.conflictDetector.extracted.text2")}

            {checked && !loading && conflicts.length > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                {conflicts.length}
              </span>
            )}
          </h3>
          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
            {t("components.conflictDetector.extracted.text3")}
            {manifestNames.length}
            {t("components.conflictDetector.extracted.text4")}
          </p>
        </div>
        <Button
          appearance="secondary"
          size="small"
          onClick={runDetection}
          disabled={loading}
          icon={loading ? <Spinner size="tiny" /> : <ArrowSyncRegular />}
        >
          {t("components.conflictDetector.extracted.text5")}
        </Button>
      </div>

      {/* Content */}
      <div className="p-6">
        {loading && (
          <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
            <Spinner size="extra-small" />
            {t("components.conflictDetector.extracted.text6")}
          </div>
        )}

        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}

        {checked && !loading && conflicts.length === 0 && (
          <MessageBar intent="success" data-testid="conflict-none">
            <MessageBarBody>{t("components.conflictDetector.extracted.text7")}</MessageBarBody>
          </MessageBar>
        )}

        {conflicts.length > 0 && (
          <div className="max-h-[400px] space-y-3 overflow-y-auto pr-1" data-testid="conflict-list">
            {conflicts.map((conflict, idx) => (
              <div
                key={idx}
                className="overflow-hidden rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20"
                data-testid="conflict-card"
              >
                <div className="mb-2 flex items-start gap-2">
                  <WarningRegular className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span className="min-w-0 flex-1 break-words text-sm font-semibold text-amber-800 dark:text-amber-300">
                    {t("components.conflictDetector.extracted.text8")}
                    {conflict.setting}
                  </span>
                </div>
                <div className="space-y-1.5 pl-6">
                  {conflict.manifests.map((manifest, mIdx) => (
                    <div
                      key={mIdx}
                      className="flex flex-wrap items-start gap-2 text-sm text-amber-700 dark:text-amber-400"
                    >
                      <span className="shrink-0 break-words font-medium">{manifest}:</span>
                      <code className="min-w-0 flex-1 break-all rounded bg-white/60 px-1.5 py-0.5 text-xs dark:bg-slate-800/60">
                        {JSON.stringify(conflict.values[mIdx])}
                      </code>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
