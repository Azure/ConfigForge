# CIS benchmark data (not bundled)

ConfigForge **does not** redistribute CIS Benchmarks data. CIS
Benchmarks are copyrighted material distributed by the [Center for
Internet Security](https://www.cisecurity.org/cis-benchmarks/) under
their own license terms; bundling derived YAML/JSON/XCCDF files in a
public open-source repository is not compatible with those terms.

The CIS cross-reference feature (sidebar in the manifest editor,
compliance % report, audit-pack PDF section) is **disabled by default**
and gracefully degrades to "no match found" when these files are
absent.

## To enable the feature on your own machine

If you (or your organization) have a legally licensed copy of CIS
Benchmark content, drop the following files into this directory:

```
public/_baselines/cis/
├── _data/
│   ├── cis-mappings.json            # OVAL test → OSConfig property table (your own work)
│   ├── cis-rule-id-mappings.json    # Stable rule-name → instance-GUID map (your own work)
│   ├── cis-ws2025-rules.json        # Per-OS rule catalog (CIS-derived; YOUR licensed copy)
│   ├── cis-ws2022-rules.json
│   ├── cis-ws2019-rules.json
│   └── cis-ws2016-rules.json
└── cis-ws<year>-{ms,dc}.osc.yaml    # OSConfig manifests derived from your CIS catalogs
```

The expected JSON shapes are documented in
[`packages/core/src/cis/data.ts`](../../../packages/core/src/cis/data.ts)
(search for the
`CisGlobalMappings`, `CisRuleCatalog`, etc. type definitions).

The OSConfig project's
[`mc/CIS`](https://github.com/microsoft/osconfig/tree/main/mc/CIS)
PowerShell scripts can generate these artifacts from a CIS XCCDF +
OVAL pair you supply yourself.

## Packaging safety

Licensed CIS files in this directory are for local development only. Move them
out of the repository before building an installer. Local `dist*` commands and
release workflows run `scripts/verify-public-package-assets.mjs`, which fails
if CIS XCCDF, OVAL, catalog, or derived baseline content could enter packaged
public assets.

## What still works without these files

- The full manifest editor, deploy, audit, history, rationale, audit
  pack PDF, AI analyzer, diff matrix — everything except the CIS
  features below.
- Any CIS catalog entries are hidden from the **Library** page.

## What does **not** work without these files

- The CIS cross-reference sidebar in the manifest editor returns
  "no match" for every resource.
- The `cfs.cis.lookup` IPC operation returns no benchmark match.
- Benchmark compliance reports cannot score a baseline against a catalog that
  is not present on disk.
- The audit-pack PDF skips the "CIS coverage" section.
