# Third-party software notices

ConfigForge uses the following open-source software at build and
runtime. Licenses listed are the latest known at the time this document
was generated. The authoritative license text for each dependency ships
inside the installed application bundle under each package's own copy
in `node_modules/<package>/LICENSE`.

This file lists every direct dependency whose code is either shipped in
the application bundle or incorporated into a generated runtime bundle.
The release SBOM is the authoritative transitive inventory and is
published with every release.

For Microsoft trademarks and the OSConfig CLI integration, see NOTICE.

---

## Direct runtime and bundled dependencies

| # | Package | License | Purpose | Upstream |
|---|---|---|---|---|
| 1 | **@fluentui/react-components** | MIT | FluentUI v9 primitives (Dialog, Button, MessageBar, Spinner, etc.) | https://github.com/microsoft/fluentui |
| 2 | **@fluentui/react-icons** | MIT | Fluent icon set | https://github.com/microsoft/fluentui-system-icons |
| 3 | **@monaco-editor/react** | MIT | Code editor (YAML/JSON/MOF manifest authoring) | https://github.com/suren-atoyan/monaco-react |
| 4 | **dompurify** | (Apache-2.0 OR MPL-2.0) | XSS sanitization for rendered HTML; pinned via a root `overrides` entry and reached through the bundled Monaco editor | https://github.com/cure53/DOMPurify |
| 5 | **electron-log** | MIT | Main-process logging | https://github.com/megahertz/electron-log |
| 6 | **electron-updater** | MIT | In-app auto-update channel | https://github.com/electron-userland/electron-builder |
| 7 | **fast-xml-parser** | MIT | CIS XCCDF and OVAL XML parsing | https://github.com/NaturalIntelligence/fast-xml-parser |
| 8 | **i18next** | MIT | Localization runtime | https://github.com/i18next/i18next |
| 9 | **i18next-browser-languagedetector** | MIT | OS/browser locale detection | https://github.com/i18next/i18next-browser-languageDetector |
| 10 | **js-yaml** | MIT | YAML parsing / serialization for manifests | https://github.com/nodeca/js-yaml |
| 11 | **monaco-editor** | MIT | Underlying Monaco editor library | https://github.com/microsoft/monaco-editor |
| 12 | **pdfkit** | MIT | Audit-pack PDF generation | https://github.com/foliojs/pdfkit |
| 13 | **react** | MIT | UI library | https://github.com/facebook/react |
| 14 | **react-dom** | MIT | React DOM renderer; the renderer entry point mounts through `react-dom/client` | https://github.com/facebook/react |
| 15 | **react-i18next** | MIT | React bindings for localized UI strings | https://github.com/i18next/react-i18next |
| 16 | **react-router-dom** | MIT | Hash-based client routing in the renderer | https://github.com/remix-run/react-router |
| 17 | **zustand** | MIT | Lightweight state-store support | https://github.com/pmndrs/zustand |

## Other direct development and build dependencies

| Package | License | Purpose |
|---|---|---|
| ESLint + @typescript-eslint/* | MIT | Linting |
| Vitest | MIT | Test runner |
| @testing-library/react, @testing-library/user-event, @testing-library/jest-dom | MIT | React testing primitives |
| jsdom | MIT | DOM emulation for tests |
| Playwright | Apache-2.0 | Smoke / e2e tests |
| sharp | Apache-2.0 | Icon resizing in build pipeline |
| autoprefixer / postcss | MIT | CSS post-processing |
| electron | MIT | Desktop runtime packaged by the build pipeline |
| electron-builder | MIT | Installer packaging (NSIS, AppImage, deb, rpm, tar.gz) |
| vite / @vitejs/plugin-react | MIT | Renderer build tooling |
| typescript | Apache-2.0 | Type checking and compilation |
| esbuild | MIT | Electron main and preload bundling |
| tailwindcss | MIT | Utility-first styling generation |

## License compatibility notes

- All listed runtime dependencies are MIT or Apache-2.0 (or dual-licensed
  with Apache-2.0). Both are compatible with the MIT license under which
  ConfigForge itself is distributed.
- No GPL / LGPL / AGPL dependencies are present in the runtime path. If a
  transitive dependency surfaces a copyleft license, it must be replaced
  or hoisted out of the runtime tree before the next release.
- Transitive devDependency licenses are not enumerated here. Review the
  release SBOM for the authoritative transitive inventory of each build.

## How to regenerate this file

```bash
npx license-checker --production --json > licenses.json
# Curate top-N by direct dependency from apps/desktop/package.json
# and packages/core/package.json into the table above.
```

When updating dependencies, re-run the check and update this file in the
same PR. The CONTRIBUTING.md "Pre-PR bar" mentions this explicitly.

---

## Microsoft trademarks

For trademark policy specific to Microsoft properties (Windows, OSConfig,
Azure, etc.) that ConfigForge interoperates with, see NOTICE.
