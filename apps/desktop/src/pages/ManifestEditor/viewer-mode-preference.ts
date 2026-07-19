// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import type { ManifestViewerMode } from "./components/ManifestContent";

export const MANIFEST_VIEWER_MODE_STORAGE_KEY = "cfs.manifest-viewer-mode-by-baseline.v1";

function isViewerMode(value: unknown): value is ManifestViewerMode {
  return value === "code" || value === "visual";
}

function readPreferences(): Record<string, ManifestViewerMode> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MANIFEST_VIEWER_MODE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, ManifestViewerMode] =>
          entry[0].length > 0 && isViewerMode(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

export function readManifestViewerMode(manifestName: string): ManifestViewerMode {
  return readPreferences()[manifestName] ?? "code";
}

export function writeManifestViewerMode(manifestName: string, mode: ManifestViewerMode): void {
  if (typeof window === "undefined" || !manifestName) return;
  try {
    const preferences = readPreferences();
    preferences[manifestName] = mode;
    window.localStorage.setItem(MANIFEST_VIEWER_MODE_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Viewer preference is non-critical when storage is unavailable.
  }
}
