// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Button,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
} from "@fluentui/react-components";
import {
  DesktopRegular,
  DismissRegular,
  DocumentMultipleRegular,
  MoreHorizontalRegular,
} from "@fluentui/react-icons";
import {
  useBaselineWorkspace,
  type BaselineWorkspacePlatform,
} from "./BaselineWorkspace";
import { WindowsLogo } from "./WindowsLogo";

function BaselineTabPlatformIcon({
  platform,
}: {
  platform: BaselineWorkspacePlatform | undefined;
}) {
  if (platform === "windows") {
    return (
      <span aria-hidden="true" data-platform="windows" className="inline-flex shrink-0">
        <WindowsLogo className="h-4 w-4" />
      </span>
    );
  }
  if (platform === "linux") {
    return (
      <span
        aria-hidden="true"
        data-platform="linux"
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-sm leading-none"
      >
        🐧
      </span>
    );
  }
  return (
    <span aria-hidden="true" data-platform={platform ?? "unknown"} className="inline-flex shrink-0">
      <DesktopRegular className="h-4 w-4" />
    </span>
  );
}

export function baselineNameFromPath(pathname: string): string | null {
  const match = /^\/manifests\/([^/]+)(?:\/|$)/.exec(pathname);
  if (!match || match[1] === "new") return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function isBaselineWorkspacePath(pathname: string): boolean {
  return pathname === "/manifests" || baselineNameFromPath(pathname) !== null;
}

export function BaselineWorkspaceTabs() {
  const { t } = useTranslation("manifests");
  const location = useLocation();
  const navigate = useNavigate();
  const { openBaselines, baselinePlatforms, openBaseline, closeBaseline } =
    useBaselineWorkspace();
  const activeBaseline = baselineNameFromPath(location.pathname);
  const allActive = location.pathname === "/manifests";

  useEffect(() => {
    if (activeBaseline) openBaseline(activeBaseline);
  }, [activeBaseline, openBaseline]);

  const goToBaseline = (name: string) => {
    navigate(`/manifests/${encodeURIComponent(name)}`);
  };

  const closeTab = (name: string) => {
    closeBaseline(name);
    if (activeBaseline === name) navigate("/manifests");
  };

  return (
    <nav
      aria-label={t("workspace.navigationLabel")}
      className="shrink-0 border-b border-slate-200 bg-slate-50/95 px-4 pt-2 dark:border-slate-800 dark:bg-slate-950/70"
    >
      <div className="flex min-w-0 items-end gap-1">
        <div
          role="tablist"
          aria-label={t("workspace.openTabsLabel")}
          className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto [scrollbar-color:theme(colors.slate.300)_transparent] [scrollbar-width:thin] dark:[scrollbar-color:theme(colors.slate.700)_transparent]"
        >
          <button
            type="button"
            role="tab"
            aria-selected={allActive}
            onClick={() => navigate("/manifests")}
            className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              allActive
                ? "border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300"
                : "border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            }`}
          >
            <DocumentMultipleRegular className="h-4 w-4" aria-hidden="true" />
            {t("workspace.allBaselines")}
          </button>

          {openBaselines.map((name) => {
            const active = activeBaseline === name;
            return (
              <div
                key={name}
                role="presentation"
                className={`flex shrink-0 items-center border-b-2 ${
                  active
                    ? "border-blue-600 bg-white dark:border-blue-400 dark:bg-slate-900"
                    : "border-transparent"
                }`}
                title={name}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => goToBaseline(name)}
                  className={`inline-flex max-w-56 items-center gap-1.5 px-3 py-2 text-left text-sm font-medium ${
                    active
                      ? "text-slate-950 dark:text-white"
                      : "text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white"
                  }`}
                  title={name}
                >
                  <BaselineTabPlatformIcon platform={baselinePlatforms[name]} />
                  <span className="block truncate">{name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => closeTab(name)}
                  aria-label={t("workspace.closeTab", { name })}
                  title={t("workspace.closeTab", { name })}
                  className="mr-1 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                >
                  <DismissRegular aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>

        {openBaselines.length > 0 && (
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <Button
                appearance="subtle"
                size="small"
                icon={<MoreHorizontalRegular />}
                aria-label={t("workspace.moreTabs")}
                title={t("workspace.moreTabs")}
                className="mb-1 shrink-0"
              />
            </MenuTrigger>
            <MenuPopover>
              <MenuList aria-label={t("workspace.moreTabs")}>
                {openBaselines.map((name) => (
                  <MenuItem
                    key={name}
                    onClick={() => goToBaseline(name)}
                    aria-current={activeBaseline === name ? "page" : undefined}
                    icon={<BaselineTabPlatformIcon platform={baselinePlatforms[name]} />}
                  >
                    <span className="max-w-80 truncate" title={name}>
                      {name}
                    </span>
                  </MenuItem>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
        )}
      </div>
    </nav>
  );
}
