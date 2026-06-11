# History, snapshots, retention

> **v0.3.48:** snapshotting and restoring source YAML do **not**
> require the OSConfig CLI. They read and write the local manifest
> store only. The Restore *re-apply* step (the optional second half
> of a restore on an already-deployed manifest) does run
> `oscfg apply`. That part falls back to the
> `CliRequiredModal` if OSConfig is missing, exactly like a normal
> Deploy.

Every save in ConfigForge writes a **snapshot**, a
content-addressable copy of the source YAML plus an optional JSON
sidecar. The snapshots collectively form a per-manifest history that
underpins diff, restore, audit-pack export, and every other
"what-was-it?" surface.

## Where snapshots live

```text
~/.configforge/history/<namespace>/
├── 2026-03-01T14-22-00.000Z.a3f8b1c4.osc.yaml      ← payload
├── 2026-03-01T14-22-00.000Z.a3f8b1c4.osc.yaml.meta ← sidecar (JSON)
├── 2026-03-01T14-27-12.000Z.7d3e1942.osc.yaml
└── 2026-03-01T14-27-12.000Z.7d3e1942.osc.yaml.meta
```

The filename is `<ISO-8601-timestamp-with-dashes>.<8-hex-random-suffix>.osc.yaml`
and the sidecar appends `.meta` to the full filename.

Override the home directory with the `CONFIGFORGE_HOME` env var
(used by tests).

## Sidecar shape

```json
{
  "message": "AuditAccountLockout modified",
  "author": "Alice Hardener",
  "authorEmail": "alice@example.com",
  "rationale": "OPM-12345 audit"
}
```

| Field | Since | Notes |
| --- | --- | --- |
| `message` | v0.3.47 real summaries | Optional line shown in the History panel. Editor saves now use a real change summary when available (for example, `AuditAccountLockout modified`) instead of always `Manifest registered`. |
| `author`, `authorEmail` | Rationale capture | Resolved via `resolveAuthor()`. |
| `rationale` | Rationale capture | The "Why?" modal text. |

The sidecar is written **only when at least one field is non-empty**.
Old sidecars that predate these fields just carry `message`. The loader is
defensive (any field with the wrong type is treated as absent). The
History panel displays `message` below the timestamp, so v0.3.47+
snapshots show the diff summary rather than the generic registration
label when the editor provided one.

## Dedupe

Identical content saved twice in a row results in **one** history
entry. The second save returns the existing entry rather than
writing a duplicate. The check is content-hash-based (`sha256` of
the source YAML) and only compares against the IMMEDIATE PREDECESSOR
so the operation stays O(1) regardless of history size.

> **Note:** Dedupe deliberately preserves the *first* `message` /
> `author` / `rationale`. To truly rewrite metadata, delete the
> snapshot file and re-save.

## Retention

The retention sweep runs after every successful save:

```text
CONFIGFORGE_HISTORY_MAX_COUNT (default 50)
  -1 or 0   → disable pruning
  N > 0     → keep the N newest entries; oldest pruned
```

The sweep is best-effort. Failure never fails the save.

### Settings store (v0.3.1+)

As of v0.3.1, you can configure history retention from the
**Settings** page instead of relying on the environment variable.
The allowed range is 5 to 1,000 snapshots. The Settings value takes
precedence over `CONFIGFORGE_HISTORY_MAX_COUNT` when set.

## Pre-deploy snapshot rotation

Each deploy now saves a timestamped backup of the manifest source
alongside the `latest` pointer. The backup filename includes the
ISO-8601 timestamp so you can correlate it with deploy logs. This
means you always have a recoverable copy even if the deploy
overwrites the working file.

## Deploy-recovery banner

If a deploy is interrupted (process crash, forced close, power loss),
the dashboard shows a recovery banner on the next launch. The banner
links to the most recent pre-deploy snapshot so you can review and
restore it. The banner dismisses automatically once you acknowledge
or restore.

## Restore

Restore *replays* a prior snapshot:

1. **Pre-restore snapshot** - the current YAML is snapshotted before
   the restore runs. You can
   always undo a restore by restoring the pre-restore entry.
2. The chosen snapshot becomes the new
   `~/.configforge/manifests/<ns>.source.yaml`.
3. If the manifest was deployed, `oscfg apply` re-applies the
   restored YAML. **This step requires the OSConfig CLI**. If it's
   missing the restore stops after step 2 and surfaces the
   `CliRequiredModal` so you can install OSConfig and retry.

The pre-restore snapshot's `message` is `pre-restore: <id>` so it's
easy to spot in the history list.

## Snapshot ID format

```text
2026-03-01T14-22-00.000Z.a3f8b1c4
└─────────────┬─────────────┘ └────┬───┘
              │                    └─ 8 hex chars from randomBytes(4)
              └─ ISO-8601 UTC timestamp with `:` replaced by `-`
```

The format sorts lexicographically. `ls` returns chronological
order. The 8-hex suffix is a random collision suffix (NOT a content
hash); it disambiguates multiple writes within the same millisecond
without paying a sha256 on the way in. Content-hash dedupe is a
separate, predecessor-only check (see *Dedupe* above).

## Performance & limits

| Constraint | Value |
| --- | --- |
| Max retained entries (default) | 50 |
| Sweep cost | O(N) per save where N = retained entries |
| Path traversal | Refused at the security boundary |
| Concurrent writes | Per-namespace mutex |

## IPC surface

The renderer talks to the history store through the typed preload
bridge:

- `cfs.history.list({ name })` - list snapshot summaries (no
  payloads). Pass `{ name, id }` to fetch one snapshot's payload +
  sidecar.
- `cfs.history.save({ name, content, message? })` - manual
  snapshot.
- `cfs.history.delete({ name, id })` - delete a snapshot.
- Revert is a separate handler (`cfs:deploy:run` with the revert
  action), which restores the **pre-deploy snapshot** (NOT an
  arbitrary history entry; see the API page).

See [API Reference → History / import / export](../api-reference/history-import-export.md).

## See also

- [User Guide → Rationale](./rationale.md)
- [User Guide → Audit-pack](./audit-pack.md) (consumes history)
