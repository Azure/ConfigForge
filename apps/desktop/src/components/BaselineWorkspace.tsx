// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";
import { BASELINE_CATALOG } from "../data/baseline-catalog";
import { cfs } from "../lib/cfs";

export const BASELINE_WORKSPACE_STORAGE_KEY = "cfs.baseline-workspace.open-baselines.v1";

export type BaselineWorkspacePlatform =
  | "windows"
  | "linux"
  | "mixed"
  | "cross-platform";

/**
 * Recoverable portion of a deleted registration. The delete API also removes
 * deployment, history, rationale, and audit state; those are intentionally
 * not represented because the available APIs cannot restore them.
 */
export interface DeletedBaselineRegistrationBackup {
  name: string;
  displayName: string;
  content: string;
  source: "user" | "library" | "import";
  sourceId?: string;
  reopen: boolean;
}

function normalizeNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    const name = candidate.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function readPersistedBaselines(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(BASELINE_WORKSPACE_STORAGE_KEY);
    return raw ? normalizeNames(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function normalizePlatform(value: unknown): BaselineWorkspacePlatform | undefined {
  return value === "windows" ||
    value === "linux" ||
    value === "mixed" ||
    value === "cross-platform"
    ? value
    : undefined;
}

export interface BaselineWorkspaceValue {
  openBaselines: string[];
  baselinePlatforms: Record<string, BaselineWorkspacePlatform | undefined>;
  myBaselineCount: number;
  microsoftBaselineCount: number;
  lastDeletedBatch: DeletedBaselineRegistrationBackup[] | null;
  setLastDeletedBatch: (value: SetStateAction<DeletedBaselineRegistrationBackup[] | null>) => void;
  openBaseline: (name: string) => void;
  openManyBaselines: (names: Iterable<string>) => void;
  closeBaseline: (name: string) => void;
  closeManyBaselines: (names: Iterable<string>) => void;
  pruneOpenBaselines: (availableNames: Iterable<string>) => void;
  /**
   * Reload the authoritative lite registration list, update the count,
   * and remove persisted tabs whose registrations no longer exist.
   */
  refresh: () => Promise<string[]>;
}

const BaselineWorkspaceContext = createContext<BaselineWorkspaceValue | null>(null);

export function BaselineWorkspaceProvider({ children }: { children: ReactNode }) {
  const [openBaselines, setOpenBaselines] = useState<string[]>(readPersistedBaselines);
  const [baselinePlatforms, setBaselinePlatforms] = useState<
    Record<string, BaselineWorkspacePlatform | undefined>
  >({});
  const [myBaselineCount, setMyBaselineCount] = useState(0);
  const [microsoftBaselineCount, setMicrosoftBaselineCount] = useState(BASELINE_CATALOG.length);
  // Deliberately memory-only: Undo applies to the most recent delete batch
  // in this renderer session and must not survive an app restart.
  const [lastDeletedBatch, setLastDeletedBatch] = useState<
    DeletedBaselineRegistrationBackup[] | null
  >(null);
  const refreshTokenRef = useRef(0);

  useEffect(() => {
    try {
      window.localStorage.setItem(BASELINE_WORKSPACE_STORAGE_KEY, JSON.stringify(openBaselines));
    } catch {
      // localStorage can be unavailable under hardened browser policies.
      // Workspace navigation still works for the current process.
    }
  }, [openBaselines]);

  const openManyBaselines = useCallback((names: Iterable<string>) => {
    const additions = normalizeNames(Array.from(names));
    if (additions.length === 0) return;
    setOpenBaselines((current) => {
      const next = [...current];
      const seen = new Set(current);
      for (const name of additions) {
        if (!seen.has(name)) {
          seen.add(name);
          next.push(name);
        }
      }
      return next.length === current.length ? current : next;
    });
  }, []);

  const openBaseline = useCallback(
    (name: string) => {
      openManyBaselines([name]);
    },
    [openManyBaselines],
  );

  const closeManyBaselines = useCallback((names: Iterable<string>) => {
    const removals = new Set(normalizeNames(Array.from(names)));
    if (removals.size === 0) return;
    setOpenBaselines((current) => {
      const next = current.filter((name) => !removals.has(name));
      return next.length === current.length ? current : next;
    });
  }, []);

  const closeBaseline = useCallback(
    (name: string) => {
      closeManyBaselines([name]);
    },
    [closeManyBaselines],
  );

  const pruneOpenBaselines = useCallback((availableNames: Iterable<string>) => {
    const available = new Set(normalizeNames(Array.from(availableNames)));
    setOpenBaselines((current) => {
      const next = current.filter((name) => available.has(name));
      return next.length === current.length ? current : next;
    });
  }, []);

  const refresh = useCallback(async () => {
    const token = ++refreshTokenRef.current;
    const response = await cfs.manifests.list({ lite: true });
    const entries = Array.isArray(response.data) ? response.data : [];
    const names = normalizeNames(
      entries.map((entry) => entry?.Name),
    );
    if (token !== refreshTokenRef.current) return names;
    const nextPlatforms: Record<string, BaselineWorkspacePlatform | undefined> = {};
    for (const entry of entries) {
      if (typeof entry?.Name !== "string") continue;
      const name = entry.Name.trim();
      if (!name) continue;
      nextPlatforms[name] = normalizePlatform(entry.Platform);
    }
    setBaselinePlatforms(nextPlatforms);
    setMyBaselineCount(names.length);
    setMicrosoftBaselineCount(BASELINE_CATALOG.length);
    pruneOpenBaselines(names);
    return names;
  }, [pruneOpenBaselines]);

  useEffect(() => {
    void refresh().catch(() => {
      // Preserve the persisted tabs and previous counts when the IPC list
      // is temporarily unavailable. A later route entry or Refresh retries.
    });
  }, [refresh]);

  const value = useMemo<BaselineWorkspaceValue>(
    () => ({
      openBaselines,
      baselinePlatforms,
      myBaselineCount,
      microsoftBaselineCount,
      lastDeletedBatch,
      setLastDeletedBatch,
      openBaseline,
      openManyBaselines,
      closeBaseline,
      closeManyBaselines,
      pruneOpenBaselines,
      refresh,
    }),
    [
      openBaselines,
      baselinePlatforms,
      myBaselineCount,
      microsoftBaselineCount,
      lastDeletedBatch,
      openBaseline,
      openManyBaselines,
      closeBaseline,
      closeManyBaselines,
      pruneOpenBaselines,
      refresh,
    ],
  );

  return (
    <BaselineWorkspaceContext.Provider value={value}>{children}</BaselineWorkspaceContext.Provider>
  );
}

export function useBaselineWorkspace(): BaselineWorkspaceValue {
  const value = useContext(BaselineWorkspaceContext);
  if (!value) {
    throw new Error("useBaselineWorkspace must be used within BaselineWorkspaceProvider");
  }
  return value;
}
