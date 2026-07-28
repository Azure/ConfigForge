# `cfs.auditPack.*` — audit-pack generation

> **Phase 10 transport note.** Was `/api/manifests/[id]/audit-pack`.
> `buildAuditPackArtifact` in `packages/core/src/handlers/audit-pack.ts`
> now backs two IPC channels: `cfs:audit-pack:get` (returns bytes
> in-process — used by the iframe preview via `cfs-blob://`) and
> `cfs:audit-pack:save` (native save dialog). Contract preserved.
> Supports PDF and markdown output, with RFC 6266 filenames.

## `cfs.auditPack.get(req)` — channel `cfs:audit-pack:get`

Generate a self-contained audit-pack and return the bytes in-process.
Used by the renderer for the iframe preview pane.

```ts
type AuditPackRequest = {
  id: string;                              // manifest namespace
  format?: 'pdf' | 'markdown';             // default 'pdf'
  against?: string | null;                 // BASELINE_CATALOG id for compliance section
  disposition?: 'inline' | 'attachment';   // default 'attachment'
};

type AuditPackArtifact = {
  filename: string;                        // <sanitized-ns>-audit-pack-YYYYMMDD.{pdf|md}
  contentType: string;
  bytes: Uint8Array;                       // PDF binary or UTF-8 markdown
};
```

## `cfs.auditPack.save(req)` — channel `cfs:audit-pack:save`

Same handler, but main pops a native save dialog and writes bytes
directly. Returns `{ ok: true, path, filename }` on success or
`IpcErrorEnvelope` on user-cancel. The pure artifact also carries a
`contentDisposition` field (ASCII + RFC 5987 `filename*=UTF-8''…`) for
non-IPC hosts.

## Sections (PDF)

Builder: `packages/core/src/audit-pack/`. Section order: header →
device audit (when present) → compliance → version history → rationale
log → citations → footer.

| Section | Source | Without source |
| --- | --- | --- |
| Header | registration metadata | always present |
| Device audit | `~/.configforge/audit-results/<ns>.json` (v0.1.6) | omitted |
| Compliance | `ComplianceReport` (when `against` is set AND CIS data present) | "not available" line |
| Version history | history snapshots + author/rationale | columns render `—`; max 50 rows |
| Rationale log | `~/.configforge/rationale/<ns>.jsonl` | omitted; max 30 entries |
| Citations | analysis `Provenance` records | omitted (no on-disk provenance store yet) |
| Footer | timestamp + page numbers | always present |

> Each section is no-throw best-effort. A failing section emits a
> single "(section unavailable)" line; one bad input doesn't poison
> the whole PDF.

### HTML escaping (CF-SEC-005 / 006)

Markdown (`packages/core/src/audit-pack/markdown.ts`) and PDF text both
escape user values via `packages/core/src/markdown/escape.ts` before
embedding. `<script>` in a rationale reason renders as literal text in
both formats.

## Performance

| Input | Wall-clock | Byte size |
| --- | --- | --- |
| 50 rules, 5 history entries | < 0.5 s | — |
| 350 rules, 50 history entries | < 3 s | < 2 MB |

`pdfkit` returns a `Readable`; the handler concatenates to a `Buffer`
and returns `new Uint8Array`. Streaming-large packs go through the
`cfs-blob://audit-pack/<id>` protocol instead. Built-in Helvetica fonts;
non-WinAnsi chars → `?`.

## Errors

| Status | When |
| --- | --- |
| 400 | Missing manifest id, or `format` not `pdf` / `markdown`. |
| 404 | Manifest not registered. |
| 500 | Unexpected error (e.g. `pdfkit` crash). |

## See also

- [User Guide → Audit-pack](../user-guide/audit-pack.md)
- [API Reference → `cfs.compliance.report`](./compliance.md)
- [API Reference → `cfs.rationale.*`](./rationale.md)
- [Architecture → Module map](../architecture/module-map.md)
