# Visual QA — Localization Overflow Audit (v0.3.61 prep)

## Fixed in this pass
| File | Element | Risk | Fix |
| --- | --- | --- | --- |

No category 🔴 breakages were fixed in code. The Wave 6 length warnings either render in wrapping text surfaces, browser/native dialogs, or non-visible attributes; clear fixed-width + nowrap breakage was not found for the flagged translations.

## Flagged for manual visual QA by Amir
| Key | Locale | English | Translation length | Render location | Note |
| --- | --- | --- | --- | --- | --- |
| `manifest-editor:visual.usePicker` | de | Use the picker to add resources. | 60 chars / 188% | `apps/desktop/src/pages/ManifestEditor/components/ManifestContent.tsx:295-299` | 🟡 Visual-builder empty state in a two-column grid. Text should wrap in the dashed panel, but verify centered German copy does not look awkward. |
| `manifests:new.extracted.text66` | de | Use the picker to add resources. | 60 chars / 188% | `apps/desktop/src/pages/ManifestNew/index.tsx:815-821` | 🟡 New-manifest visual-builder empty state. Same copy as above; wrapping is allowed. |
| `common:update.ready-body` | de | v{{version}} downloaded. Restart to install. | 75 chars / 170% | `apps/desktop/src/components/UpdateBanner.tsx:190-210` | 🟡 Success MessageBar with adjacent Restart button. Fluent layout should wrap, but check narrow window width. |
| `settings:messages.welcomeResetFailed` | fr | Could not reset first-run experience. | 63 chars / 170% | `apps/desktop/src/pages/Settings.tsx:220-223` | 🟢 MessageBar body wraps; no fixed width found. |
| `manifest-editor:visual.usePicker` | fr | Use the picker to add resources. | 54 chars / 169% | `apps/desktop/src/pages/ManifestEditor/components/ManifestContent.tsx:295-299` | 🟡 Same visual-builder empty-state check as German. |
| `manifests:new.extracted.text66` | fr | Use the picker to add resources. | 54 chars / 169% | `apps/desktop/src/pages/ManifestNew/index.tsx:815-821` | 🟡 Same new-manifest empty-state check as German. |
| `manifests:confirm.bulkDeploy_one` | de | Deploy {{count}} manifest to this device? | 68 chars / 166% | `apps/desktop/src/pages/Manifests/index.tsx:262` | 🟢 Native `confirm()` dialog, no app layout overflow risk. |
| `manifest-editor:visual.usePicker` | es | Use the picker to add resources. | 53 chars / 166% | `apps/desktop/src/pages/ManifestEditor/components/ManifestContent.tsx:295-299` | 🟡 Same visual-builder empty-state check as German. |
| `manifests:new.extracted.text66` | es | Use the picker to add resources. | 53 chars / 166% | `apps/desktop/src/pages/ManifestNew/index.tsx:815-821` | 🟡 Same new-manifest empty-state check as German. |
| `dialogs:cli-required.installed-recheck` | de | I installed it, recheck | 38 chars / 165% | `apps/desktop/src/components/CliRequiredModal.tsx:140-155` | 🟡 Dialog action button. No explicit fixed width, but verify Fluent dialog actions on narrow widths. |
| `manifests:new.extracted.text37` | de | to verify the engine is working | 51 chars / 165% | `apps/desktop/src/pages/ManifestNew/index.tsx:544-555` | 🟢 Inline list item; wrapping is allowed next to the code token. |
| `cis-catalog:extracted.text5` | de | tab will also be available on the | 53 chars / 161% | `apps/desktop/src/pages/CisCatalog.tsx:147-156` | 🟢 Paragraph copy with inline spans; wraps normally. |
| `manifest-editor:compliance.emptyDescription` | de | Run Audit or Enforce to check this baseline against the device. | 101 chars / 160% | `apps/desktop/src/pages/ManifestEditor/components/ComplianceTable.tsx:42-49` | 🟡 Empty compliance panel. It wraps, but verify centered two-line copy in the table card. |
| `history:empty.sectionTitle` | de | No history recorded for this manifest | 59 chars / 159% | Not currently consumed; `ManifestHistory.tsx:302-304` is hardcoded English | 🟢 No translated overflow surface today. Separate localization gap if History empty state is in scope later. |
| `diff:errors.analyzeFailed` | de | Failed to analyze diff | 35 chars / 159% | `apps/desktop/src/pages/Diff/index.tsx:119-125` | 🟢 Error fallback only; MessageBar/error surfaces wrap. |
| `common:health.install-hint` | de | Install OSConfig to deploy and audit on this machine. | 84 chars / 158% | `apps/desktop/src/components/HealthIndicator.tsx:55-59` | 🟢 Used as `title` tooltip, not visible layout text. |
| `manifests:new.extracted.text37` | es | to verify the engine is working | 49 chars / 158% | `apps/desktop/src/pages/ManifestNew/index.tsx:544-555` | 🟢 Inline list item; wrapping is allowed. |
| `cis-catalog:extracted.text5` | es | tab will also be available on the | 52 chars / 158% | `apps/desktop/src/pages/CisCatalog.tsx:147-156` | 🟢 Paragraph copy; wraps normally. |
| `manifests:new.extracted.text37` | fr | to verify the engine is working | 48 chars / 155% | `apps/desktop/src/pages/ManifestNew/index.tsx:544-555` | 🟢 Inline list item; wrapping is allowed. |
| `cis-catalog:extracted.text5` | fr | tab will also be available on the | 51 chars / 155% | `apps/desktop/src/pages/CisCatalog.tsx:147-156` | 🟢 Paragraph copy; wraps normally. |
| `manifests:messages.deployFailedFor` | de | Deploy failed for "{{name}}" | 43 chars / 154% | `apps/desktop/src/pages/Manifests/index.tsx:289-300` | 🟢 Error object text; downstream alert surfaces wrap. |
| `settings:systemHealth.install.title` | de | Install OSConfig to deploy and audit on this device | 78 chars / 153% | `apps/desktop/src/pages/Settings.tsx:268-279` | 🟡 Settings health card title. Container has `min-w-0` and wraps; verify two-line German title remains acceptable. |
| `manifests:card.revertTitle` | de | Undo the last deployment of {{name}} from this device | 80 chars / 151% | `apps/desktop/src/pages/Manifests/index.tsx:719-725` | 🟢 Used in `title` attribute for icon-only Revert button; no visible overflow. |
| `proactive:sidebar.nav.*` | all | Sidebar navigation labels | varies | `apps/desktop/src/components/Sidebar.tsx:76-138` | 🟡 Fixed `w-60` sidebar with translatable nav labels and no truncation. Current German/French/Spanish labels fit, but this is a high-visibility future overflow zone. |
| `proactive:compliance.reason-tooltip` | all | Dynamic compliance reason tooltip | dynamic | `apps/desktop/src/components/compliance-badge.tsx:70-76` | 🟡 Tooltip uses `whitespace-nowrap` and can exceed the viewport for long dynamic reasons. Not locale text, so not fixed in this pass. |
| `proactive:manifest-editor.status-column` | all | Compliance table status header/cells | varies | `apps/desktop/src/pages/ManifestEditor/components/ComplianceTable.tsx:51-73` | 🟡 Fixed 120px status column with `whitespace-nowrap`. Current labels are short; future translations of status labels should be verified. |
| `proactive:manifests.deploy-menu` | all | Manifest card deploy menu labels | varies | `apps/desktop/src/pages/Manifests/index.tsx:682-703` | 🟡 Fixed `w-48` menu containing translatable action labels/descriptions. Current labels likely fit; verify in German. |
| `proactive:manifest-header.deploy-menu` | all | Manifest editor deploy menu labels | varies | `apps/desktop/src/pages/ManifestEditor/components/ManifestHeader.tsx:276-295` | 🟡 Fixed `w-56` dropdown containing translatable action labels/descriptions. Current German audit label likely fits; verify. |
| `proactive:footer.health-indicator` | de | CLI health detail text | varies | `apps/desktop/src/components/Layout.tsx:62-79`, `apps/desktop/src/components/HealthIndicator.tsx:84-103` | 🟡 Footer has version text + health indicator in one row. German installed/admin states may squeeze at narrow widths. |
| `proactive:language-toggle` | fr/de/es | Language option buttons | 31 chars / 155% for system labels | `apps/desktop/src/pages/Settings.tsx:451-473` | 🟡 Below REVIEW threshold because English is exactly 20 chars. Toggle uses `flex-wrap`, but verify the `system` option does not dominate the row. |

## Recommendations for future work
- Add visual snapshot coverage for German on the manifest editor visual-builder empty state, ManifestNew visual-builder empty state, Settings health card, and UpdateBanner success state.
- Consider a reusable `.min-w-0` / wrapping helper for Fluent `MessageBarBody` + adjacent actions if narrow-window QA shows wrapping issues.
- For fixed menus (`w-48`, `w-56`) that contain translated labels, prefer `min-w-max max-w-[min(22rem,calc(100vw-2rem))]` or allow menu item text wrapping if a future locale expands further.
- For non-locale dynamic text tooltips, replace unbounded `whitespace-nowrap` with a max-width wrapping tooltip pattern before accepting long provider/error messages.
- Keep REVIEW.md’s ratio warnings paired with render-location notes; short strings can have high ratios but still be safe when they render in wrapping paragraphs or attributes.
