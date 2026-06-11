# ConfigForge Author — macOS preview

This is the **macOS author-only build**. Manifest authoring,
library, cross-baseline compliance comparison, audit-pack PDF,
and manifest-vs-manifest diff — same as the Windows + Linux
builds. **Deploy / audit / enforce on a device is not included**
on this flavor (use the Windows or Linux installer for that).

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

A future release will be signed + notarized via an Apple
Developer cert and this step won't be needed.

## What's in this build

- **Author** — full YAML editor (Monaco) + visual resource picker
- **Library** — 17 bundled Microsoft baselines:
  Windows Server 2016 / 2019 / 2022 / 2025 (member, DC, workgroup),
  Microsoft Defender Antivirus, Windows LAPS, Windows Secured Core,
  Windows OpenSSH, Azure Local SFF Linux Security Baseline
- **Compliance** — diff your manifest against any bundled reference
  baseline; matched / mismatched / missing rule counts + per-rule
  detail panel
- **Audit Pack** — generate a Markdown / PDF bundle with the
  manifest header, version history, rationale log, and the
  reference-baseline comparison
- **Diff** — manifest-vs-manifest pairwise + N-way matrix view
- **History** — versioned snapshots of every manifest edit, with
  revert
- **Rationale log** — capture and search per-edit reasoning notes

## What's NOT in this build

- No deploy / audit / enforce on a device (oscfg CLI is not
  bundled — use the Windows or Linux installer to actually
  apply settings to a target machine)
- No admin / root elevation surface
- No "Recent Activity" deploy event feed

## Architecture: arm64 only

This `.dmg` ships an arm64 Electron + node binary, native to
Apple Silicon (M1+). Intel Macs run it via Rosetta 2 with no
configuration required.

## Reporting issues

This is a `dev` preview tag. If you hit something broken, file
an issue at <https://github.com/ABMFST/ConfigForge/issues>
with the `mac-author` label.
