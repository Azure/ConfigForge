# Rationale & change-author capture

> **Note:** The features on this page are forward-compatible.
> Old `~/.configforge/manifests/`
> snapshots without author or rationale fields still load cleanly.
>
> **v0.3.48:** the rationale prompt + log are local features.
> No OSConfig CLI required. Capturing *why* a manifest changed
> works identically in Editor mode and CLI-installed mode.

The research preceding this sprint surfaced a clear auditor demand:
*"Who changed this and why?"* must be answerable without grepping
through chat threads. Two cooperating mechanisms close the gap:

1. **Author resolution** - every history snapshot stamps a
   best-effort `{name, email}` pair.
2. **Rationale log** - a per-manifest append-only JSONL of
   "I changed X from A to B because Y" entries.

## Author resolution

`packages/core/src/history/author.ts` exposes `resolveAuthor()`. The
resolution order, first to produce a non-empty name wins:

1. The `CONFIGFORGE_AUTHOR` env var. Format `Name <email>` or just
   `Name`.
2. `git config user.name` + `git config user.email`. Best-effort,
   any failure (no git installed, missing config, non-zero exit)
   silently falls through to the next strategy.
3. `os.userInfo().username` for `name`, empty for `email`.
4. Final fallback: `{name: 'unknown', email: ''}`.

The result is cached for the process lifetime. Repeated calls don't
re-shell `git`. The function is documented as **never throws** (every
strategy is wrapped in a `try/catch`).

```powershell
# Override before launching the desktop app:
$env:CONFIGFORGE_AUTHOR = 'Alice Hardener <alice@example.com>'
npm run desktop:dev
```

## Where the author and rationale are stored

The rationale prompt appears when you save changed content in the
Manifest editor. The submitted reason is stored alongside that save's
History snapshot and appended to the per-manifest rationale log.

Each history snapshot's `.meta` sidecar
(`~/.configforge/history/<ns>/<id>.osc.yaml.meta`)
gains optional fields:

```json
{
  "message": "AuditAccountLockout modified",
  "author": "Alice Hardener",
  "authorEmail": "alice@example.com",
  "rationale": "OPM-12345, required by Q1 audit"
}
```

Old `.meta` files that predate these fields don't have `author` / `authorEmail`
/ `rationale`; the loader treats those fields as `undefined` and
moves on. Since v0.3.47, the `message` field is the real change summary
when the editor can compute one (for example, `AuditAccountLockout
modified`) instead of the older generic `Manifest registered` label.

## The "Why?" modal

When the editor detects a save where any resource value changes
relative to the most recent saved version, it pops a single modal
with:

- A textarea (1-500 chars) for the rationale.
- A **Skip** button. Writes a rationale entry with `skipped: true`.
- A **Save & continue** button. Submits the rationale alongside the snapshot.
- A **Cancel** button. Closes the modal *without* saving (so you
  can keep editing and decide later).

The modal is intentionally cheap. It doesn't block typing in the
editor, just intercepts the save. Skipping is fine; the rationale
log will record the skip so an auditor can see the change happened
intentionally without an explanation. A double-click guard suppresses
duplicate submissions while the save is in flight.

## Per-manifest rationale log

Beyond what's stamped on each snapshot, every change appends a line
to `~/.configforge/rationale/<ns>.jsonl`:

```json
{"ts":"2026-03-01T14:22:00Z","author":"Alice","resourceName":"MaxAuthTries","oldValue":5,"newValue":3,"reason":"OPM-12345 audit ask"}
```

The log is append-only. Concurrent writers are safe via a per-file
lock; a streaming reader handles logs over 10MB without loading the
whole thing into memory.

## Sidebar surfaces

The editor sidebar shows the **last 3 rationale entries** for the
currently-selected resource, with author and timestamps. The timestamp
uses distinct styling from the author name for easier scanning.

## IPC surface

The renderer talks to the rationale store through the typed preload
bridge:

- `cfs.rationale.list(id)` → `{ entries: [...] }`. Full per-manifest
  log, oldest-first. The editor sidebar and the full-log page reverse
  for display.
- `cfs.rationale.append(req)`. Append a rationale entry. Validates
  payload size and rejects `reason` over 500 chars. Empty reason is
  allowed only when `skipped: true`.
- Manifest delete (`cfs.manifests.delete(name)`) calls
  `deleteRationale(ns)` so the JSONL file doesn't outlive its parent
  manifest.

See [API Reference → Rationale](../api-reference/rationale.md) for
the request / response shapes.

## Full log page

Navigate to **Manifests → click a manifest → Rationale** (the
**View all →** link in the editor sidebar lands here too). The full
log page lives at
[`apps/desktop/src/pages/ManifestRationale.tsx`](https://github.com/ABMFST/ConfigForge/blob/main/apps/desktop/src/pages/ManifestRationale.tsx)
and shows every entry across all resources, with:

- A search filter over resource / author / reason text.
- A **Show skipped entries** toggle.
- Per-row stat cards (total / captured / skipped).
- A CSV-injection-safe **Download CSV** button. Cells beginning
  with `=`, `+`, `-`, `@`, `\t`, or `\r` are prefixed with `'`
  before serialization (OWASP CSV-injection guard).

## How auditors consume this

The PDF [audit-pack](./audit-pack.md) renders a **Version history**
section with author and rationale columns when present, followed by
a dedicated **Rationale log** section (the latter has been wired up
to a real store, not a stub). If the manifest lacks those
fields, those columns are simply omitted. No broken layout, no fake
data.

## See also

- [API Reference → Rationale](../api-reference/rationale.md)
- [User Guide → History & snapshots](./history-snapshots.md)
- [User Guide → Audit-pack](./audit-pack.md)
