# Audit-pack (PDF + Markdown)

> **v0.3.48:** the audit-pack works without OSConfig installed in the
> Full edition. It
> reads from the manifest store, history, rationale log, and
> persisted device-audit snapshots, none of which require the CLI to
> be present at generation time. (If you haven't run an Audit yet, the
> Device-Audit section is simply omitted from the pack; install
> OSConfig and run an audit to populate it.)
>
> Both the PDF and the Markdown emitter pass user-supplied and
> generated content through the
> [`packages/core/src/markdown/escape.ts`](https://github.com/Azure/ConfigForge/blob/main/packages/core/src/markdown/escape.ts)
> guard (CF-SEC-005 / CF-SEC-006), so HTML / Markdown injection
> embedded in a manifest name, rationale entry, or generated suggestion is
> rendered as literal text.

The audit-pack is the auditor deliverable: a single self-contained
document per manifest that answers *what's deployed?*, *how does it
score?*, and *who changed what?*. If persisted analysis provenance is added
later, citations can render too; today live analysis provenance is not stored
per manifest.

## Generate

In the UI:

1. Open any manifest's detail view.
2. Click **Audit Pack** (top-right action bar). Lands on the
   `audit-pack` sub-page for that manifest.
3. Choose **PDF** (primary) or **Markdown** (secondary). A live PDF
   preview renders inline.

The PDF and Markdown forms are served by the same `cfs:audit-pack:get`
IPC handler (and `cfs:audit-pack:save` for the file-system "Save as…"
flow). PDFs come back as `application/pdf`; Markdown as
`text/markdown; charset=utf-8`.

## What's in it (PDF)

The PDF builder lives in
[`packages/core/src/audit-pack/`](https://github.com/Azure/ConfigForge/blob/main/packages/core/src/audit-pack/index.ts).
The PDF is assembled in this fixed order:

| # | Section | Source data | Behaviour without source |
| - | --- | --- | --- |
| 1 | **Title page** | manifest name, OS, last-applied / last-audited timestamps | always present |
| 2a | **Device-audit snapshot** (v0.1.6) | last persisted `auditResults` run for this manifest (audit or enforce) | section omitted when no audit has been run |
| 2b | **Compliance scorecard** | `ComplianceReport` (only when a local CIS comparison is requested) | section omitted when no comparison is requested |
| 3 | **Version history** | history snapshots + author/rationale | author/rationale columns render `(none)` if absent; max 50 rows |
| 4 | **Rationale log** | `~/.configforge/rationale/<ns>.jsonl` (loaded by `tryLoadRationale` in `audit-pack/rationale-loader.ts`) | section omitted if log empty; otherwise newest-first with timestamp + author + resource + reason (skipped entries appear with a `(rationale skipped)` sentinel) |
| 5 | **Analysis provenance citations** | analysis `Provenance` bundle | section omitted. See "Known gaps" below |
| – | **Footer** | generation timestamp, page numbers | always present |

> **Note:** The audit-pack is intentionally forward-compatible. If a
> manifest was authored before rationale capture existed, the
> version-history table omits the author/rationale columns rather
> than rendering empty cells. Each section is wrapped in a
> `safeSection` guard. A render failure in one section drops a
> "(section unavailable)" line and the rest of the document still
> emits.
>
> **⚠ Known gap, analysis provenance:** The PDF builder accepts a
> `provenance` input, but there is **no per-manifest provenance
> store**. The type layer + helpers ship in
> `@configforge/core/ai/provenance` (`decorateWithProvenance`,
> `dedupeSources`, `computeCitationCoverage`). Provenance is
> attached to live analysis results inside the analyzer, but never
> persisted to disk. The audit-pack handler's `tryLoadProvenance`
> therefore always returns `undefined` and the **Citations** section
> is omitted from every audit pack today. Wiring this up requires (a)
> deciding the storage shape, (b) hooking the analyzer to append on
> each analysis result, (c) hooking the manifest editor's "accept
> suggestion" flow to persist alongside the manifest snapshot. Until
> then the Citations section will not render.

## What's in it (Markdown)

The Markdown form includes manifest metadata and can include compliance,
version-history, rationale, and citations when those inputs are available.
The Full edition can also include device-audit inputs; the macOS Author
edition does not expose device-audit storage. It exists primarily so a CI job can
produce a diff-able artifact and so air-gapped reviewers without a PDF
viewer can still skim the report. The same escape guard runs on
Markdown output (CF-SEC-005 / 006).

## Implementation notes

- The builder uses `pdfkit` for PDF output.
- The artifact handler returns PDF bytes or Markdown text through the
  same `cfs:audit-pack:get` / `cfs:audit-pack:save` IPC surface.
- Fonts: built-in Helvetica + Helvetica-Bold to avoid font-bundling.

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
Get-Content audit-pack.pdf -TotalCount 1 -Encoding Byte | ForEach-Object { '{0:X2}' -f $_ }
# 25 50 44 46 ...   → %PDF-
```

The first four bytes are always the magic `%PDF-`; tests assert
this rather than parse the binary.

## See also

- [API Reference → Audit-pack](../api-reference/audit-pack.md)
- [User Guide > Benchmark Mapping](./cis-compliance.md)
- [User Guide → Rationale](./rationale.md)
- [User Guide → Analysis provenance](./analysis-provenance.md)
