// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ShieldFilled,
  SettingsFilled,
  SettingsRegular,
  BoardRegular,
  BoardFilled,
  DocumentRegular,
  DocumentFilled,
  CheckmarkCircleRegular,
  CheckmarkCircleFilled,
  BookOpenRegular,
  BookOpenFilled,
  BookmarkRegular,
  BookmarkFilled,
  BranchCompareRegular,
  BranchCompareFilled,
  NavigationRegular,
  DismissRegular,
} from "@fluentui/react-icons";
import { useBaselineWorkspace } from './BaselineWorkspace';

// Each nav item declares both Outline and Filled variants. Per Fluent
// v2 design guidance the Filled variant is reserved for the active
// (selected) state of a navigation control; Outline is the rest
// state. This is one of the few places in the design system where
// icon-style swapping carries semantic meaning rather than being
// purely decorative.
const navItems = [
  { href: '/', labelKey: 'nav.home', icon: BoardRegular, iconActive: BoardFilled, end: true },
  { href: '/manifests', labelKey: 'nav.manifests', icon: DocumentRegular, iconActive: DocumentFilled, end: false },
  { href: '/library', labelKey: 'nav.library', icon: BookOpenRegular, iconActive: BookOpenFilled, end: false },
  { href: '/compliance', labelKey: 'nav.validation', icon: CheckmarkCircleRegular, iconActive: CheckmarkCircleFilled, end: false },
  { href: '/diff', labelKey: 'nav.diff', icon: BranchCompareRegular, iconActive: BranchCompareFilled, end: false },
  // v0.3.0 (#11): CIS Catalog moved out of the editor drawer's
  // permanent footprint into its own sidebar entry. Easy to prune
  // later if we decide we don't want the integration: delete this
  // line + the /cis route + the page file.
  { href: '/cis', labelKey: 'nav.cis-mapping', icon: BookmarkRegular, iconActive: BookmarkFilled, end: false },
  { href: '/settings', labelKey: 'nav.settings', icon: SettingsRegular, iconActive: SettingsFilled, end: false },
] as const;

/**
 * Application sidebar. Mirrors the Next.js app's sidebar visually
 * (Phase 5 keeps Tailwind, Phase 6 swaps to FluentUI). Uses
 * `react-router-dom`'s `NavLink` for active-route detection
 * (replaces Next's `usePathname`).
 */
export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { t } = useTranslation(['sidebar', 'common']);
  const { myBaselineCount, microsoftBaselineCount } = useBaselineWorkspace();

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="fixed top-3 left-3 z-50 rounded-md bg-slate-900 p-2 text-slate-300 md:hidden"
        aria-label={t('common:a11y.toggle-sidebar')}
      >
        {collapsed ? <DismissRegular size={20} /> : <NavigationRegular size={20} />}
      </button>

      {/* Mobile overlay */}
      {collapsed && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setCollapsed(false)}
        />
      )}

      <aside
        className={`
          fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-slate-900 text-slate-300
          transition-transform duration-200 ease-in-out
          ${collapsed ? 'translate-x-0' : '-translate-x-full'}
          md:static md:translate-x-0
        `}
      >
        <div className="flex items-center gap-2.5 border-b border-slate-700/60 px-5 py-5">
          <div className="relative flex items-center justify-center">
            {/* App-mark uses Filled variants — this is a logo, not a
                nav control, so it always reads at maximum visual
                weight regardless of the surrounding state. */}
            <ShieldFilled size={26} className="text-blue-500" />
            <SettingsFilled
              size={12}
              className="absolute -bottom-0.5 -right-0.5 text-blue-400"
            />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold text-white">ConfigForge</span>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map(({ href, labelKey, icon: Icon, iconActive: IconActive, end }) => (
            <NavLink
              key={href}
              to={href}
              end={end}
              onClick={() => setCollapsed(false)}
              className={({ isActive }) =>
                // H5 fix — `bg-blue-500/15 text-blue-400` against the
                // navy `bg-slate-900` rail measured ~2.8:1 and the
                // active route was hard to spot at a glance. Bumped
                // the wash to /30, raised the foreground to
                // text-blue-300, and added a 2px left accent border
                // for a clearer "you are here" cue. Padding is
                // adjusted (pl-[10px] active vs px-3 rest) so the
                // text glyph doesn't shift horizontally when the
                // border appears/disappears across navigations.
                `flex items-center gap-3 rounded-md py-2 pr-3 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-500/30 text-blue-300 border-l-2 border-blue-500 pl-[10px]'
                    : 'pl-3 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`
              }
            >
              {({ isActive }) => {
                // Phase 6.2: swap Outline → Filled on the active route
                // per Fluent v2 nav guidance. The visible weight change
                // is subtle but reinforces the blue tint cue and brings
                // the sidebar in line with WinUI 3 Gallery's behavior.
                const NavIcon = isActive ? IconActive : Icon;
                const count =
                  href === '/manifests'
                    ? myBaselineCount
                    : href === '/library'
                      ? microsoftBaselineCount
                      : null;
                return (
                  <>
                    <NavIcon size={18} className={isActive ? 'text-blue-400' : ''} />
                    <span>
                      {t(labelKey)}
                      {count !== null ? ` (${count})` : ''}
                    </span>
                  </>
                );
              }}
            </NavLink>
          ))}
        </nav>

        {/* H6 fix — `text-slate-500` on `bg-slate-900` measured ~3.5:1
            (borderline AA for body copy). Bumped to slate-400 so the
            version footer is comfortably legible. */}
        <div className="border-t border-slate-700/60 px-5 py-3 text-[11px] text-slate-400">
          {t('common:footer.osconfig-version-next')}
        </div>
      </aside>
    </>
  );
}
