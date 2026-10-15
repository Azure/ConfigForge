# Audit-pack (PDF + Markdown)

Use **Audit Pack** to export a baseline review report as PDF or Markdown.
It is available in **both Full and macOS Author editions**, without the
OSConfig CLI, packaging modules, or Azure.

**An Audit Pack is not a device Audit.** It assembles available saved baseline
metadata, review results, history, and rationale. It does not inspect a
machine, apply settings, or establish current compliance. If no saved device
audit exists, that section is omitted; macOS Author cannot run device audits.
Benchmark coverage likewise does not prove device compliance.

## Generate

In the UI:

1. Open a saved baseline from **My Baselines**.
2. Select **Audit Pack** to open the report page.
3. Choose **Download PDF** or **Download Markdown**. A PDF
   preview renders inline.

Before sharing, check which sections are present, the baseline identity, and
any device-result timestamps. Report unavailable or stale evidence explicitly.
Export **YAML** separately if the recipient also needs the baseline source.
Review names, rationale, and device details for sensitive information.

## What's in it (PDF)

Sections appear only when their input is available:

| # | Section | Source data | Behaviour without source |
| --- | --- | --- | --- |
| 1 | **Title page** | manifest name, OS, last-applied / last-audited timestamps | always present |
| 2a | **Device-audit snapshot** (v0.1.6) | last persisted `auditResults` run for this manifest (audit or enforce) | section omitted when no audit has been run |
| 2b | **Compliance scorecard** | `ComplianceReport` (only when a local CIS comparison is requested) | section omitted when no comparison is requested |
| 3 | **Version history** | history snapshots + author/rationale | author/rationale columns render `(none)` if absent; max 50 rows |
| 4 | **Rationale log** | `~/.configforge/rationale/<ns>.jsonl` (loaded by `tryLoadRationale` in `audit-pack/rationale-loader.ts`) | section omitted if log empty; otherwise newest-first with timestamp + author + resource + reason (skipped entries appear with a `(rationale skipped)` sentinel) |
| 5 | **Analysis provenance citations** | analysis `Provenance` bundle | section omitted. See the known-gap note below |
| – | **Footer** | generation timestamp, page numbers | always present |

> **Known gap: analysis provenance.** Live analysis provenance is not stored
> per baseline, so normal UI-generated Audit Packs omit the Citations section.
> Do not describe the report as a complete cited evidence record.
> A report can also contain a "(section unavailable)" message if a section
> could not render; review the output, not just whether a file downloaded.

## What's in it (Markdown)

The Markdown form includes manifest metadata and can include
device-audit, compliance, version-history, rationale, and citations
when those inputs are available. It exists primarily so a CI job can
produce a diff-able artifact and so air-gapped reviewers without a PDF
viewer can still skim the report. The same escape guard runs on
Markdown output (CF-SEC-005 / 006).

## Implementation notes

These details are for contributors; they are not required to export a report.

- The builder uses `pdfkit` for PDF output.
- The artifact handler returns PDF bytes or Markdown text through the
  same `cfs:audit-pack:get` / `cfs:audit-pack:save` IPC surface.
- Fonts: built-in Helvetica + Helvetica-Bold to avoid font-bundling.
- PDF and Markdown output escape user-supplied/generated text through
  [`escape.ts`](https://github.com/Azure/ConfigForge/blob/main/packages/core/src/markdown/escape.ts).
- The handler can accept provenance, but `tryLoadProvenance` returns
  `undefined` until a per-baseline provenance store is implemented. See
  [analysis provenance](./analysis-provenance.md) and the
  [API reference](../api-reference/audit-pack.md).

## Customizing

The audit-pack is intentionally opinionated. Two practical knobs:

- **Format** - use **Download PDF** or **Download Markdown** in the
  UI, or pass `format: 'pdf' | 'markdown'` to the audit-pack IPC
  request.
- **Pipe Markdown elsewhere** - consumers wanting a custom layout
  typically pipe the Markdown through a downstream converter (pandoc,
  etc.).

## Verification

A quick "is this really a PDF?" check on a saved file:

```powershell
[System.IO.File]::ReadAllBytes((Resolve-Path '.\audit-pack.pdf').Path)[0..3] |
  ForEach-Object { '{0:X2}' -f $_ }
# 25 50 44 46   → %PDF
```

These four bytes spell `%PDF`. This is only a file-format check, not
validation that the report is complete or that a device is compliant.

## See also

- [API Reference → Audit-pack](../api-reference/audit-pack.md)
- [User Guide > Benchmark Mapping](./cis-compliance.md)
- [User Guide → Rationale](./rationale.md)
- [User Guide → Analysis provenance](./analysis-provenance.md)
