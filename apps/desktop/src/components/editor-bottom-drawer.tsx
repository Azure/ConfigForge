// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useState, type ReactNode } from "react";
import { ChevronUpRegular, ChevronDownRegular } from "@fluentui/react-icons";

export interface DrawerTab {
  id: string;
  /** Tab label shown in the bottom bar. */
  label: string;
  /** Optional small badge (e.g. count or status). Rendered to the right of the label. */
  badge?: ReactNode;
  /** Optional icon rendered to the left of the label. */
  icon?: ReactNode;
  /** Lazy-rendered content. Only rendered when the tab is the active/expanded one. */
  content: ReactNode;
  /** When true, the tab is disabled (greyed out, not clickable). */
  disabled?: boolean;
  /** Hover/disabled-state tooltip on the tab. */
  title?: string;
}

export interface EditorBottomDrawerProps {
  tabs: DrawerTab[];
  /** Expanded height in pixels when a tab is open. Defaults to 280. */
  expandedHeight?: number;
  /** Tab-bar height in pixels when collapsed. Defaults to 32. */
  collapsedHeight?: number;
  /**
   * Initial tab id to show. When undefined (default), the drawer starts
   * collapsed so the editor gets back its full vertical space — the
   * user opts in by clicking a tab.
   */
  initialTab?: string;
}

/**
 * Tabbed bottom drawer for the manifest editor — modelled after the
 * VS Code Problems/Terminal panel. Each tab can be clicked to expand;
 * clicking the active tab again collapses the drawer.
 *
 * Designed to give the editor its full horizontal width back: reference
 * info (CIS cross-reference, recent rationale) lives below the editor
 * and is opt-in per-tab instead of permanently consuming a sidebar
 * column.
 */
export function EditorBottomDrawer({
  tabs,
  expandedHeight = 120,
  collapsedHeight = 32,
  initialTab,
}: EditorBottomDrawerProps) {
  const [activeId, setActiveId] = useState<string | null>(initialTab ?? null);
  const expanded = activeId !== null;
  const active = expanded ? tabs.find((t) => t.id === activeId) ?? null : null;

  return (
    <div
      className="flex shrink-0 flex-col border-t border-slate-700 bg-slate-950/60"
      style={{ height: expanded ? expandedHeight : collapsedHeight }}
      data-testid="editor-bottom-drawer"
    >
      {/* Content panel (rendered above the tab bar so the bar stays anchored to the bottom). */}
      {expanded && active && (
        <div className="flex-1 overflow-y-auto text-xs" data-testid={`drawer-content-${active.id}`}>
          {active.content}
        </div>
      )}
      {/* Tab bar — always visible. */}
      <div className="flex h-8 shrink-0 items-stretch border-t border-slate-800 bg-slate-900/80">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                if (tab.disabled) return;
                setActiveId(isActive ? null : tab.id);
              }}
              disabled={tab.disabled}
              title={tab.title ?? (tab.disabled ? "Unavailable" : isActive ? `Hide ${tab.label}` : `Show ${tab.label}`)}
              className={[
                "flex items-center gap-1.5 border-r border-slate-800 px-3 text-xs transition-colors",
                tab.disabled
                  ? "cursor-not-allowed text-slate-600"
                  : isActive
                    ? "bg-slate-800/80 text-slate-100"
                    : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200",
              ].join(" ")}
              data-testid={`drawer-tab-${tab.id}`}
              data-active={isActive ? "true" : "false"}
            >
              {tab.icon}
              <span className="font-medium">{tab.label}</span>
              {tab.badge != null && tab.badge !== false && (
                <span className="ml-1 inline-flex items-center">{tab.badge}</span>
              )}
              {isActive ? (
                <ChevronDownRegular className="ml-1 h-3 w-3 text-slate-500" />
              ) : (
                <ChevronUpRegular className="ml-1 h-3 w-3 text-slate-500" />
              )}
            </button>
          );
        })}
        {/* Spacer / chrome on the right. */}
        <div className="flex-1" />
      </div>
    </div>
  );
}
