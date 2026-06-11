# Smoke testing on Windows

CI doesn't have an `oscfg` binary, so end-to-end CLI smokes are
**only valid in an elevated PowerShell** on Windows. This page
documents the manual smoke pass that goes alongside a release.

## Pre-conditions

1. OSConfig CLI installed per [INSTALL.md](../../../INSTALL.md)
   (winget recommended). `oscfg --version` should report
   `1.3.9-preview11` (or whatever ConfigForge currently
   targets).
2. PowerShell launched **as administrator**.
3. The app built from source - `npm ci && npm run desktop:build` -
   and launched from the same elevated PowerShell, either by
   running the built `apps/desktop/release/win-unpacked/configforge.exe`
   or by `npm run desktop:dev` (hot-reload Vite + Electron).

## The seven-step UI smoke

There is no HTTP API - every step is driven through the Electron UI.

| Step | Where | What to check |
| --- | --- | --- |
| **1. Health pill** | Footer | 🟢 **OSConfig CLI v1.3.9-preview11**. Click → opens Settings → System Health. Confirm admin status `true` and binary `source` is one of `installed` / `path` / `env` / `msix`. |
| **2. Library** | Sidebar → Library | Catalog renders, **Use as Template** button works on at least one baseline (e.g. Windows Server 2025 Member). |
| **3. ManifestNew** | Manifests → New | Paste the [first-manifest example](../quick-start/first-manifest.md). Register succeeds with `warnings: []`. The fast list (Manifests page) shows it without a CLI spawn - toggle Refresh repeatedly to exercise `listTokenRef`. |
| **4. ManifestEditor** | Manifests → click your new namespace | YAML / JSON / Visual tabs all render the same content. Edit a property, save, history snapshot appears. |
| **5. Audit (read-only)** | ManifestEditor → Deploy → Audit | Returns 200 with `compliance` populated. On Windows still requires admin (preview-CLI log-file bug). |
| **6. Enforce** | ManifestEditor → Deploy → Enforce | Returns 200 with `result: 'applied'`. Cross-check with `oscfg get resource -n smoke-registry` from a separate elevated shell. |
| **7. Diff** | Sidebar → Diff | Pick two registered manifests (e.g. your new one + a Library baseline). Pairwise diff and the master matrix both render; column filters work. |

Tear-down: open Manifests, multi-select your smoke namespaces, click
**Delete**.

> **Tip:** Run the renderer with the Chromium DevTools (View →
> Toggle Developer Tools, or `Ctrl+Shift+I`) for the duration of the
> smoke so you can capture network/IPC traffic and console errors.

## What success looks like

- Step 1: green pill, admin true, no `CLI_REQUIRED` envelopes in the
  IPC log.
- Step 3: register response has `warnings: []` on a Windows host
  registering a Windows manifest. Soft warnings only appear for
  platform mismatches or unknown types.
- Step 5: audit completes in <3s for a small manifest.
- Step 6: enforce returns `'applied'`; the registry value is visible
  from `reg query HKLM\Software\ConfigForge`.
- Step 7: matrix renders without race-guard regressions (rapid tab
  switches don't show stale data - that's `matrixLoadTokenRef`).

## What failure looks like

| Symptom | Cause | Fix |
| --- | --- | --- |
| Footer pill says `isAdmin: false` | PowerShell not elevated. | Restart as Administrator. |
| `<CliRequiredModal />` opens when clicking Deploy | CLI missing or not resolved. | Follow [INSTALL.md](../../../INSTALL.md), then click **Recheck** in Settings → System Health. |
| Register returns a hard error | YAML escape problem, missing `valueName`/`valueType`, or non-array `resources:`. | Re-paste; keep two-space indentation. |
| Enforce returns 403 / admin-required | Not admin, or `oscfg` rejected the policy. | Elevate. Check the translated CLI error - `runner.translateKnownErrors` rewrites the common ones. |
| Enforce returns `Policy CSP 0x82F00009` | Policy not applicable on this SKU. | Skip the policy on this machine, or use the dedicated provider per the translated hint. |

The translated CLI errors cover the common ones; the raw CLI output
is always preserved in the IPC response for debugging.

## CIS Mapping and CIS Diff smoke

CIS features are gated on user-supplied CIS data files. To exercise them:

1. Drop Azure Policy JSON or XCCDF files into the CIS data directory.
   In dev mode the path is `public/_baselines/cis/_data/` (gitignored -
   they're not redistributable from this repo); in a packaged install
   it resolves to a path under the app's resources directory. The
   **CIS Mapping** page in the app shows the resolved path. See
   [CIS Mapping](../user-guide/cis-compliance.md) for the expected layout.
2. Click **Re-check** on the CIS Mapping page. The renderer cache is
   invalidated, so a full app restart should not be required.
3. Open **Diff → CIS Diff**, pick a registered manifest, and click
   **Compare**. The table should show mapped/unmapped rows and a
   full-baseline coverage score.
4. Open a manifest in the editor and confirm the CIS drawer shows
   matches for resources covered by the supplied data.

Without CIS files, CIS-specific tabs and drawers hide or show no mapping;
the rest of the smoke is unaffected.

## Targeted fuzzy-matcher smoke

After changing CIS fuzzy matching, build core and run the targeted smoke script:

```bash
npm run core:build
node scripts/smoke-azure-policy-fuzzy.mjs
```

The script uses synthetic Azure Policy rule titles, so it does not require licensed CIS data on disk.

## See also

- [Architecture → `oscfg` CLI contract](../architecture/oscfg-cli.md)
- [Filing upstream bugs](./upstream-bugs.md)
- [Troubleshooting](./troubleshooting.md)
