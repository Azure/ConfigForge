// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useEffect } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import {
  FluentProvider,
  webLightTheme,
  webDarkTheme,
} from '@fluentui/react-components';
import { Layout } from './components/Layout';
import { WelcomeDialog } from './components/WelcomeDialog';
import { HomePage } from './pages/Home';
import { LibraryPage } from './pages/Library';
import { SettingsPage } from './pages/Settings';
import { ManifestsPage } from './pages/Manifests';
import { ManifestNewPage } from './pages/ManifestNew';
import { ManifestDetailPage } from './pages/ManifestEditor';
import { AuditPackPage } from './pages/ManifestAuditPack';
import { CompliancePage } from './pages/Compliance';
import { CisCatalogPage } from './pages/CisCatalog';
import { DiffPage } from './pages/Diff';
import { ManifestHistoryPage } from './pages/ManifestHistory';
import { RationaleLogPage } from './pages/ManifestRationale';
import { ManifestCompliancePage } from './pages/ManifestCompliance';
import { NotFoundPage } from './pages/NotFound';
import { useTheme, usePlatform } from './lib/platform';

/**
 * Application root.
 *
 * Phase 6 wraps the route tree in a FluentProvider so any nested
 * @fluentui/react-components consumer (Phase 6.2 component swap)
 * inherits the correct light/dark theme. The active theme is driven
 * by `useTheme()` from `lib/platform.ts`, which is itself driven by
 * the OS theme via `nativeTheme.shouldUseDarkColors` (forwarded over
 * the cfs:platform IPC channel) plus an optional user override in
 * localStorage.
 *
 * HashRouter (rather than BrowserRouter) because the production
 * Electron build loads the renderer via `loadFile('dist/index.html')`,
 * giving a `file://` URL whose path is the on-disk file path —
 * BrowserRouter would parse that as the route and always 404.
 * HashRouter puts the route in the URL fragment (`#/manifests/foo`)
 * which works identically across `file://`, `http://localhost:5173`
 * (vite dev), and packaged builds.
 */
export function App() {
  const theme = useTheme();
  const platform = usePlatform();

  // Toggle the `.mica-active` class on documentElement when running
  // on Win11 22000+ so foundation.css can transparent the body and
  // let the Mica backdrop bleed through. PLATFORM.md §Materials.
  //
  // v0.1.1 RDP fix: also exclude RDP / Azure DevBox sessions. The
  // main process gates `backgroundMaterial: 'mica'` off when
  // `isRemoteDesktopSession()` is true (see
  // `electron/platform-detection.ts`), so applying the
  // transparent-body class on the renderer would expose a black
  // void instead of Mica. Match the main process's gating
  // exactly: Win11 AND not RDP.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const micaActive = platform?.isWindows11 === true && platform?.isRdpSession !== true;
    if (micaActive) {
      document.documentElement.classList.add('mica-active');
    } else {
      document.documentElement.classList.remove('mica-active');
    }
  }, [platform?.isWindows11, platform?.isRdpSession]);

  return (
    <FluentProvider theme={theme === 'dark' ? webDarkTheme : webLightTheme}>
      <HashRouter>
        {/*
         * v0.2.0 first-run experience. Renders the two-card Welcome
         * dialog on first launch; persists dismissal to localStorage
         * (cfs.welcome.dismissedAt). MUST live inside <HashRouter>
         * because it calls useNavigate() to land users on /library
         * when they pick "Author baselines anywhere".
         */}
        <WelcomeDialog />
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="library" element={<LibraryPage />} />
            <Route path="manifests" element={<ManifestsPage />} />
            <Route path="manifests/new" element={<ManifestNewPage />} />
            <Route path="manifests/:id" element={<ManifestDetailPage />} />
            <Route path="manifests/:id/audit-pack" element={<AuditPackPage />} />
            <Route path="manifests/:id/compliance" element={<ManifestCompliancePage />} />
            <Route path="manifests/:id/history" element={<ManifestHistoryPage />} />
            <Route path="manifests/:id/rationale" element={<RationaleLogPage />} />
            <Route path="compliance" element={<CompliancePage />} />
            <Route path="cis" element={<CisCatalogPage />} />
            <Route path="diff" element={<DiffPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </HashRouter>
    </FluentProvider>
  );
}
