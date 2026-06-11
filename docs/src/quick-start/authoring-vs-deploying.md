# Authoring vs deploying

ConfigForge draws a sharp line between *authoring a manifest*
(safe, platform-agnostic, no CLI required) and *deploying it* (the
Full-edition operations that touch the live OS, and the only ones that
need the `oscfg` CLI installed). The macOS Author edition is for
authoring-only workflows and omits deploy/diff/audit-pack surfaces.
Mixing the two was the single biggest design defect of the pre-`unified`
editions, and unmixing them is what lets you safely author Linux
manifests on a Windows laptop - even with no CLI at all.

## The split

| Phase | IPC channel | What happens | Privileges | CLI required? | Platform-checked? |
| --- | --- | --- | --- | --- | --- |
| **Author / register** | `cfs:manifests:register` | Schema validation, source-YAML persisted, summary computed. **Never** spawns `oscfg`. | None | No | Soft warning only |
| **Deploy** | `cfs:deploy:run` (`mode=enforce`) | `oscfg apply` against the live system. | Admin/root | Yes | **Hard gate** - `'mixed'` rejected |
| **Audit** | `cfs:deploy:run` (`mode=audit`) | `oscfg get resource` - read-only check. | None on Linux; admin on Windows (preview-CLI bug) | Yes | Hard gate |
| **Revert** | `cfs:revert:run` | Re-applies a prior snapshot, or deletes the namespace. | Admin/root | Yes | Hard gate |

## CLI presence is surfaced everywhere

v0.2.0 introduced the bring-your-own-CLI contract. The state is
surfaced in three places so you never wonder which mode you are in:

- **Welcome dialog** on first launch offers two cards: *Author only*
  (Editor mode, no CLI) and *Author + deploy* (opens the install
  dialog if the CLI is missing).
- **Footer health pill** reads 🟢 **OSConfig CLI v…** when installed,
  🟠 **Editor mode, CLI not installed** otherwise. Clicking the
  amber pill opens the install dialog.
- **Settings → System Health** shows the resolved binary path,
  source (`env` / `installed` / `path` / `msix` / `bundled`), and
  admin status. A **Recheck** button re-runs the probe without
  restarting the app.

When the CLI is missing, Deploy / Audit / Revert preflight in
`packages/core/src/handlers/` throws `cliRequiredError()` (status
412, code `'CLI_REQUIRED'`), and the renderer routes that envelope
through `<CliRequiredModal />` instead of a generic error toast.

## Why this matters

Before the unified refactor, registering a Linux manifest from a
Windows machine would fail at register time with `Unsupported
resource type` or platform-mismatch errors. Authors couldn't draft a
baseline for a different OS than their workstation. Now register is
**platform-agnostic**: any well-formed manifest is accepted, the
detected platform is recorded, and a soft warning fires when the
host doesn't match - never a block.

Hard gates only fire when you ask the system to *do* something to
the live host (deploy, audit, revert) - and those gates require the
CLI to be installed in the first place.

## Soft warnings vs hard errors

- **Hard error** - the manifest is malformed (missing `resources:`,
  wrong shape, invalid Group/Test wrapper). Refused at register
  time.
- **Soft warning** - registered successfully but worth flagging:
  - manifest platform doesn't match host;
  - manifest is `'mixed'` (Windows + Linux types in one document);
  - manifest uses a type unknown to this host's `oscfg` install
    (only surfaced when the manifest *targets* this host, so
    cross-platform drafts don't spam false positives).

See [Architecture → Registration semantics](../architecture/registration-semantics.md)
for the full state machine, and
[Architecture → Mixed-platform classification](../architecture/mixed-platform.md)
for how `'mixed'` is detected.

## Practical example

You're a security engineer on a Windows workstation drafting a
baseline for a Linux fleet (no `oscfg` installed yet - that's fine):

1. Paste the Linux YAML into the editor.
2. **Register** - succeeds, with a `warnings[]` entry: *"Manifest
   targets `linux`, host is `windows` - deploy from a Linux
   machine."*
3. The manifest now lives in `~/.configforge/manifests/<ns>.json`.
   In the Full edition, you can run [Diff](../user-guide/matrix-diff.md),
   score it against [CIS](../user-guide/cis-compliance.md), and export an
   [audit-pack](../user-guide/audit-pack.md) - none of which need
   `oscfg`.
4. **Deploy** is rejected on the Windows machine (`'CLI_REQUIRED'`
   if the CLI isn't installed; `'mixed'`/platform-mismatch if it
   is). Install the target device's OSConfig CLI from
   <https://github.com/microsoft/osconfig/tree/main/docs/cli>, then move
   the registration JSON + source YAML to a Linux box (or re-register
   there) to deploy.

> **Tip:** Snapshots and history work in the authoring phase too -
> nothing about [version history](../user-guide/history-snapshots.md)
> needs `oscfg` or the OS to match.
