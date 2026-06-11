# `cfs.rationale.*` — per-manifest change log

> **Phase 10 transport note.** This lived at
> `/api/manifests/[id]/rationale` (GET + POST) in the Next.js era. The
> pure handlers in `packages/core/src/handlers/rationale.ts` and
> `rationale-write.ts` now back the `cfs:rationale:list` and
> `cfs:rationale:append` IPC channels. The contract shape is preserved;
> Next.js-era CSRF guards (`src/lib/origin.ts`) are no longer needed —
> renderer → main IPC isn't subject to CSRF.
>
> Provides inline rationale + change-author capture, with cleanup on
> manifest delete.

Per-manifest append-only "why?" log. Each entry captures a single
change with author, timestamp, old/new values, and a free-text reason
(1–500 chars).

## `cfs.rationale.list(id)` — channel `cfs:rationale:list`

Return the full log wrapped in `{ entries }`. Server returns
**oldest-first**; the editor sidebar and the
[full rationale log page](../user-guide/rationale.md) reverse the list
at render time. Empty array (`{ entries: [] }`) when no log exists —
never throws on "log not found".

```ts
type RationaleEntry = {
  ts: string;
  author: string;
  resourceName: string;
  oldValue?: unknown;     // preserved as-is from the source manifest
  newValue?: unknown;
  reason: string;
  skipped?: true;         // present only when the user clicked Skip in the modal
};

const { entries } = await cfs.rationale.list('ws2025-baseline');
```

`id` is `decodeURIComponent`-tolerant and validated with `isValidNamespace`
(allowed: `A–Z`, `a–z`, `0–9`, `.`, `_`, `-`, 1–96 chars). Invalid id → 400.

## `cfs.rationale.append(req)` — channel `cfs:rationale:append`

Append a rationale entry. Author is resolved server-side via
`resolveAuthor()` (CONFIGFORGE_AUTHOR → git config → OS user →
`'unknown'`); the client cannot spoof it.

```ts
type AppendRationaleRequest = {
  id: string;
  resourceName: string;     // non-empty, max 1024 chars
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;          // 1–500 chars; empty allowed only when skipped: true
  skipped?: boolean;
};

const { ok, entry } = await cfs.rationale.append({
  id: 'ws2025-baseline',
  resourceName: 'MaxAuthTries',
  oldValue: 5,
  newValue: 3,
  reason: 'OPM-12345 — required by Q1 audit.',
});
```

The IPC payload is shape-validated by
`validateAppendRationaleRequest()` in
`apps/desktop/electron/ipc-validators.ts` (CF-SEC-002) before reaching
the handler.

### Errors

`HandlerError` codes:

| Status | When |
| --- | --- |
| 400 | Manifest id fails `isValidNamespace`, body isn't a JSON object, `resourceName` empty or > 1024 chars, `reason` empty without `skipped: true`, or `reason` over 500 chars. |
| 500 | Append lock could not be acquired within ~2 s, or filesystem error. |

There is **no** 404 path — the JSONL file is created on first append.
There's also no soft 413 cap; the rationale log can grow indefinitely
(the in-process retention sweep covers history snapshots, not rationale).

## Cleanup on manifest delete

`cfs.manifests.delete()` calls `deleteRationale(ns)` so a deleted
manifest doesn't leave an orphaned `<ns>.jsonl` on disk. The cleanup is
best-effort; any error surfaces in the delete response's
`data.rationaleLogError` field but never blocks the manifest delete.

## On-disk format

The log lives at `~/.configforge/rationale/<ns>.jsonl` — one JSON
object per line, append-only. Concurrent writers are serialized via a
per-file `<ns>.jsonl.lock` sentinel created with `O_EXCL` (atomic).
Reads stream line-by-line so multi-megabyte logs don't load into
memory.

Override the home directory with the `CONFIGFORGE_HOME` env var (used
by tests).

## See also

- [User Guide → Rationale](../user-guide/rationale.md)
- [User Guide → Audit-pack](../user-guide/audit-pack.md)
- [API Reference → `cfs.auditPack.*`](./audit-pack.md)
