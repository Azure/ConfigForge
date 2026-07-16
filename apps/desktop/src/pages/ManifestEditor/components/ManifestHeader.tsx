// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import React from "react";
import { Button, Spinner } from "@fluentui/react-components";
import { DesktopRegular, DismissRegular, EyeRegular, SaveRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import type { OscManifest } from "@configforge/core/types";
import { WindowsLogo } from "../../../components/WindowsLogo";
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
  rationaleBusy: boolean;
  onSaveClick: () => void;
  onCancelEdit: () => void;
}

function PlatformMark({
  platform,
  label,
}: {
  platform: ManifestHeaderProps["platformBadge"]["platform"];
  label: string;
}) {
  if (platform === "windows") {
    return <WindowsLogo className="h-6 w-6 shrink-0" />;
  }
  if (platform === "linux") {
    return (
      <span role="img" aria-label={label} className="text-xl leading-none">
        🐧
      </span>
    );
  }
  return (
    <span role="img" aria-label={label} className="inline-flex text-slate-500 dark:text-slate-400">
      <DesktopRegular className="h-6 w-6" aria-hidden="true" />
    </span>
  );
}

export const ManifestHeader = React.memo(function ManifestHeader({
  manifestName,
  manifest,
  platformBadge,
  editorState,
  rationaleBusy,
  onSaveClick,
  onCancelEdit,
}: ManifestHeaderProps) {
  const { editing, saving } = editorState;
  const { t } = useTranslation(["manifest-editor", "common"]);
  const displayName = manifest?.DisplayName?.trim() || manifestName;
  const platformLabel = platformBadge.label.replace(/^[^\p{L}\p{N}]+/u, "").trim();

  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <PlatformMark platform={platformBadge.platform} label={platformLabel} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
              {displayName}
            </h1>
            {!editing && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <EyeRegular className="h-3.5 w-3.5" aria-hidden="true" />
                {t("viewer.viewing")}
              </span>
            )}
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
        <div className="flex shrink-0 items-center gap-2">
          <Button appearance="secondary" icon={<DismissRegular />} onClick={onCancelEdit}>
            {t("common:buttons.cancel")}
          </Button>
          <Button
            appearance="primary"
            icon={saving || rationaleBusy ? <Spinner size="tiny" /> : <SaveRegular />}
            onClick={onSaveClick}
            disabled={saving || rationaleBusy}
          >
            {t("common:buttons.save")}
          </Button>
        </div>
      )}
    </header>
  );
});
