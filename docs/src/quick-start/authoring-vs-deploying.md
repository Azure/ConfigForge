# Authoring vs deploying

**Registering or saving a baseline does not apply it.** Start with authoring
in either edition. Only move to device operations when you deliberately want
to evaluate or change a lab machine.

The macOS Author edition includes authoring, Diff, Benchmark Mapping,
history, rationale, and Audit Pack export. It has no device Deploy, Audit,
Enforce, Revert, elevation, or CLI-health controls.

## The split

| Action | What it does | What you need |
| --- | --- | --- |
| **Author / Register / Save** | Validates structure and saves a baseline in your local workspace; does not apply settings | Either edition; no CLI, admin access, or Azure |
| **Diff / Benchmark Mapping** | Compares baseline content or maps settings to supplied rules | Either edition; your own licensed data for benchmark mapping |
| **Audit Pack** | Exports a PDF/Markdown report from available saved data; does not run an Audit | Either edition; no CLI at export time |
| **Audit** | Checks settings on the local device without intentionally applying desired values | Full edition, matching host, `oscfg`; admin on Windows, appropriate read permissions on Linux |
| **Deploy / Enforce** | Applies desired settings to the local device and checks the result | Full edition, matching host, `oscfg`, admin/root, and a recovery plan |
| **Revert** | Reapplies an available pre-deploy snapshot, or removes enforcement/registration when no usable snapshot exists | Full edition and CLI/privilege/platform requirements; not a complete machine restore |

Schema validation and benchmark coverage are **not** proof of device
compliance. A device result may also be incomplete: inspect settings marked
unread or indeterminate rather than counting them as compliant.

## CLI presence is surfaced everywhere

In the **Full edition**:

- The Welcome dialog offers **Author baselines anywhere** or
  **Author + deploy on this machine**.
- The footer shows **Editor mode, CLI not installed** when the CLI is absent.
  This is a normal authoring state; clicking it opens installation guidance.
- **Settings → System Health** shows detected CLI information.
  **Recheck** refreshes it after installation.

The native `oscfg` CLI is not bundled. Install it only for local device
operations, using [INSTALL.md](https://github.com/Azure/ConfigForge/blob/main/INSTALL.md#optional-local-device-operations).
This CLI is separate from the Microsoft.OSConfig PowerShell module used for
Machine Configuration packaging.

## Why this matters

You can author Windows baselines on a Mac or Linux computer, and Linux
baselines on Windows. Authoring does not need a matching target machine.
Deploy/Audit require a compatible local Windows/Linux host. A baseline that
mixes platform-specific Windows and Linux settings cannot be deployed as one
unit.

ConfigForge is experimental and not intended for production use. Before
changing a lab device, review every setting, take a machine backup or snapshot,
and have a recovery path. Applying security settings can affect access,
networking, and workloads.

## Soft warnings vs hard errors

- **Hard error:** malformed content, such as a missing `resources:` array or
  an invalid nested wrapper. Correct it before registering.
- **Soft warning:** registration succeeded, but the target differs from this
  computer, the baseline mixes platforms, or a type is unknown to the
  targeted CLI. Review it before any device operation.

A soft warning permits drafting; it does not promise that the remaining
settings will apply safely. Developer details remain in
[registration semantics](../architecture/registration-semantics.md) and
[platform classification](../architecture/mixed-platform.md).

## Practical example

To draft a Linux baseline on Windows or macOS:

1. Select **Microsoft Baselines → Linux Security Baseline → Use as Template**.
2. Review and **Register Baseline**. A host/target warning does not mean a
   device has been changed.
3. Use Diff, history, rationale, and Audit Pack while reviewing the draft.
4. Export YAML and import it into the Full edition on a disposable Linux
   machine when you are ready for device evaluation.
5. Install the CLI there, run **Audit** first, and inspect unread settings and
   noncompliance. Only choose **Enforce** after reviewing the intended changes
   and recovery plan.

## Azure Machine Configuration is a separate path

For Azure Policy evaluation, export **MOF** and follow
[Deploy through Azure Machine Configuration](../user-guide/machine-configuration.md).
Package creation requires **PowerShell 7**, the **GuestConfiguration** toolkit,
and the **Microsoft.OSConfig PowerShell module 1.4.10 or later** on the
packaging machine. Version 1.4.10 refers to the module, not the runtime.

The guide binds the MOF to an exact installed module version, creates an
Audit-first ZIP, tests it, and then covers hosting and policy assignment.
None of those steps is required for authoring or Audit Pack export.
