// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import React from "react";
import { Button } from "@fluentui/react-components";
import {
  DismissRegular,
  DocumentRegular,
  EditRegular,
  EyeRegular,
} from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import type { OscManifest } from "@configforge/core/types";
import type { ManifestEditorState } from "../state/useManifestEditorState";

export interface ManifestHeaderProps {
  manifestName: string;
  manifest: OscManifest | null;
  platformBadge: {
    label: string;
    cls: string;
    platform?: "windows" | "linux" | "mixed" | "cross-platform";
  };
  editorState: ManifestEditorState;
  onCancelEdit: () => void;
}

export const ManifestHeader = React.memo(function ManifestHeader({
  manifestName,
  manifest,
  platformBadge,
  editorState,
  onCancelEdit,
}: ManifestHeaderProps) {
  const { editing } = editorState;
  const { t } = useTranslation(["manifest-editor", "common"]);
  const displayName = manifest?.DisplayName?.trim() || manifestName;
  const platformLabel = platformBadge.label.replace(/^[^\p{L}\p{N}]+/u, "").trim();

  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <span
          data-testid="baseline-document-icon"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 shadow-sm dark:border-slate-600 dark:text-slate-700"
          aria-hidden="true"
        >
          <DocumentRegular className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
              {displayName}
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {editing ? (
                <EditRegular className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <EyeRegular className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {t(editing ? "viewer.editing" : "viewer.viewing")}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${platformBadge.cls}`}
            >
              {platformLabel}
            </span>
            {displayName !== manifestName && <span>{manifestName}</span>}
          </div>
        </div>
      </div>

      {editing && (
        <Button
          appearance="secondary"
          icon={<DismissRegular />}
          onClick={onCancelEdit}
          className="shrink-0"
        >
          {t("common:buttons.cancel")}
        </Button>
      )}
    </header>
  );
});
