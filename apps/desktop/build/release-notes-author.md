# ConfigForge Author 0.3.76 — macOS

This is the **macOS author-only build**. Manifest authoring,
Microsoft Baselines, cross-baseline comparison, Benchmark Mapping,
Audit Pack export, and pairwise/matrix diff are included.
**Deploy, Audit, Revert, elevation, and CLI health checks are not
included** in this flavor.

## ⚠️ First-launch install — required one-time fix

This preview is **unsigned**. macOS Sequoia + Apple Silicon will
show:

> "configforge-author" is damaged and can't be opened.
> You should move it to the Trash.

The binary is **not actually damaged** — Apple's Gatekeeper
shows this message for any unsigned app downloaded via a
browser (the browser sets the `com.apple.quarantine` extended
attribute, and modern macOS refuses to launch quarantined apps
that aren't notarized by Apple).

After installing the `.app` to `/Applications`, open Terminal
and run:

```bash
xattr -cr "/Applications/ConfigForge Author.app"
```

That clears the quarantine attribute. Double-click the app from
Launchpad or `/Applications` from there on — it launches
normally with no further prompts.

If `xattr` complains about permissions, prefix with `sudo`:

```bash
sudo xattr -rd com.apple.quarantine "/Applications/ConfigForge Author.app"
```

Release artifacts are unsigned by design.

## What's in this build

- **My Baselines workspace** — open multiple baselines in persistent
  tabs, search by namespace or display name, filter the administration
  table, compare selections, and restore deleted baseline content
  during the current session
- **Author** — YAML / JSON editing plus spreadsheet-style Visual
  editing with inline cells, setting creation, multi-row deletion,
  Test-wrapper and Group support, typed values, and exact QWord
  round-trips
- **Microsoft Baselines** — bundled Windows Server, Defender, LAPS,
  Secured Core, and Azure Local Linux authoring references
- **Benchmark Mapping** — import user-supplied XCCDF, OVAL, OCIL,
  CPE dictionary, and Azure Policy benchmark files
- **Audit Pack** — generate a Markdown / PDF bundle with the
  baseline header, version history, rationale log, and the
  reference-baseline comparison
- **Diff** — baseline-vs-baseline pairwise, CIS, and N-way matrix
  views
- **History** — versioned snapshots of every baseline edit
- **Rationale log** — capture and search per-edit reasoning notes

## What's NOT in this build

- No `oscfg` CLI detection or device operations
- No deploy / audit / enforce / revert on a device
- No admin / root elevation surface
- Recent Activity contains authoring history only, never device events

## Architecture: arm64 only

This `.dmg` ships an arm64 Electron + node binary, native to
Apple Silicon (M1+). Intel Macs run it via Rosetta 2 with no
configuration required.

## Reporting issues

If you hit something broken, file an issue at
<https://github.com/Azure/ConfigForge/issues>
with the `mac-author` label.
