# Your first baseline

**Goal:** save your own baseline in My Baselines and export a YAML copy.
Nothing in this walkthrough deploys settings or audits a device.
Use either edition of the [installed app](./install-run.md); no CLI,
administrator access, or Azure subscription is required.

A **baseline** is a set of desired settings. A **manifest** is the YAML or JSON
document describing them. **Register** means save it in ConfigForge.

## Start from a Microsoft baseline

1. Open ConfigForge. If the Welcome dialog appears, choose **Author baselines
   anywhere**.
2. Open **Microsoft Baselines** in the sidebar.
3. Choose a baseline to explore and select **Use as Template**. This opens an
   editable copy; you are not changing the bundled template.
4. Give the copy a unique name, such as `my-first-baseline`.
5. Review its settings in **Visual** or **Code**. You can save the unchanged
   copy first; you do not need to edit a security setting to complete this step.

![Microsoft Baselines catalog](https://raw.githubusercontent.com/Azure/ConfigForge/main/docs/images/screenshots/library.png)

## Register

1. Select **Register Baseline**.
2. Confirm the success message, then open **My Baselines** and find your copy.
3. Open the baseline and select **Export → YAML**.
4. Save the `.osc.yaml` file. Keep it for review or import into another
   ConfigForge workspace.

**Success:** your copy appears in My Baselines and the exported file contains
a `resources:` list. Registration is local; it does not apply settings or
publish to Azure. **Not audited** is expected for a new baseline.

If registration reports a schema error, correct it before continuing. A
platform-mismatch or unsupported-type warning means the draft needs review
before device use—not that the baseline has been tested.

## Try one edit

Open your saved copy, select **Edit**, and use **Visual** to change a value.
Select **Save** and record a short reason if prompted. Use **History** to
review changes and **Export** to save the updated baseline.
See the [editor guide](../user-guide/manifest-editor.md) for typed values,
keyboard navigation, and Code mode.

![Visual baseline editor](https://raw.githubusercontent.com/Azure/ConfigForge/main/docs/images/screenshots/visual-builder.png)

## Other starting points

In **My Baselines**, select **Create new baseline**. The setup page offers a
custom Windows/Linux baseline, a library template, a baseline file, a settings
spreadsheet, or a public URL. **Create baseline** opens the editor for review
before registration.

### Minimal Windows manifest

For a small example instead of a full template, choose **Create my own
baseline**, select Windows, and select **Create baseline**. Give it the name
`hello`, switch to Code/YAML, and replace the starter content with:

```yaml
resources:
  - name: hello-cfs-registry
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM:\Software\ConfigForge
      valueName: HelloFromCFS
      valueType: REG_SZ
      value: "1"
```

Register and export it as above. This is an **authoring example**, not a
recommended security control. Applying it later would change the registry.
YAML uses spaces, not tabs; `resources:` must be a top-level array.

### Minimal Linux manifest

For Linux, choose **Create my own baseline → Linux** and review the generated
starter in Code or Visual. Alternatively, use the bundled **Linux Security
Baseline** through **Microsoft Baselines → Use as Template**.
Treat starter values as examples, not a deployment recommendation.
You can author Linux settings on Windows or macOS without a Linux device.

## Confirm via CLI (optional)

A registered baseline is saved in **ConfigForge**, not automatically in an
`oscfg` namespace. `oscfg get namespace` is therefore not a check that this
authoring walkthrough succeeded. Confirm the saved baseline in My Baselines
and its exported YAML instead.

For a separate local lab evaluation, follow
[Authoring vs deploying](./authoring-vs-deploying.md).

## Inspect the on-disk state

For a baseline registered as `hello`, ConfigForge stores:

```text
~/.configforge/manifests/
├── hello.json              ← registration metadata
└── hello.source.yaml       ← source manifest
```

Prefer **Export → YAML** for moving a baseline to another computer, then import
it there. Do not copy live registration metadata to simulate a deployment.

## Next steps

- [Compare baselines](../user-guide/matrix-diff.md) without extra tools.
- Add your own licensed data for [Benchmark Mapping](../user-guide/cis-compliance.md).
  Coverage is not proof of device compliance.
- Export an [Audit Pack](../user-guide/audit-pack.md) for review. It does not
  run a device audit.
- Only when you need a lab evaluation, choose [local device
  operations](./authoring-vs-deploying.md) or [Azure Machine
  Configuration packaging](../user-guide/machine-configuration.md).
