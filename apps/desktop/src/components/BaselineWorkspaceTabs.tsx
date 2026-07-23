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
      className="shrink-0 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-950"
    >
      <div className="flex min-w-0 items-center gap-2">
        <div
          role="tablist"
          aria-label={t("workspace.openTabsLabel")}
          className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-color:theme(colors.slate.300)_transparent] [scrollbar-width:thin] dark:[scrollbar-color:theme(colors.slate.700)_transparent]"
        >
          <button
            type="button"
            role="tab"
            aria-selected={allActive}
            onClick={() => navigate("/manifests")}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              allActive
                ? "border-blue-600 bg-blue-600 text-white hover:border-blue-700 hover:bg-blue-700 dark:border-blue-500 dark:bg-blue-600 dark:hover:border-blue-400 dark:hover:bg-blue-500"
                : "border-slate-200 bg-white text-slate-700 hover:bg-[#E4E9F0] hover:text-slate-950 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
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
                className={`flex shrink-0 items-center rounded-full border transition-colors ${
                  active
                    ? "border-blue-600 bg-blue-600 text-white hover:border-blue-700 hover:bg-blue-700 dark:border-blue-500 dark:bg-blue-600 dark:hover:border-blue-400 dark:hover:bg-blue-500"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-[#E4E9F0] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
                title={name}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => goToBaseline(name)}
                  className={`inline-flex max-w-56 items-center gap-1.5 py-1.5 pl-3 pr-1 text-left text-sm font-medium transition-colors ${
                    active
                      ? "text-white"
                      : "text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white"
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
                  className={`mr-1 rounded-full p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${
                    active
                      ? "text-blue-100 hover:bg-blue-700 hover:text-white dark:hover:bg-blue-500"
                      : "text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                  }`}
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
                className="shrink-0 rounded-full"
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
