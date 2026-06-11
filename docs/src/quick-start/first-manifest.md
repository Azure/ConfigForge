# Your first manifest

Once `npm run desktop:dev` has opened the ConfigForge window
(or you're running an installed build), register a tiny manifest
end-to-end so you can confirm the round-trip works before authoring
anything real. No CLI install required - registration works in
Editor mode.

## Minimal Windows manifest

Save this as `hello.osc.yaml` (or just paste it directly into the
editor - you don't have to write it to disk first):

```yaml
resources:
  - name: hello-cfs-registry
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM\Software\ConfigForge
      valueName: HelloFromCFS
      valueType: String
      value: "1"
```

> **Tip:** YAML is two-space-indented; tabs are rejected by the
> parser. The `resources:` key must be a **top-level array**, not a
> string or map. `Microsoft.Windows/Registry` resources must declare
> all three of `keyPath`, `valueName`, and `valueType`. See
> [Reference → Manifest schema](../reference/manifest-schema.md) for
> the full grammar.

## Minimal Linux manifest

```yaml
resources:
  - name: hello-cfs-osconfig
    type: Microsoft.OSConfig/Test
    properties:
      resource: SshdConfig
      expression: "PermitRootLogin == 'no'"
      compliance: equal
```

## Register

In the UI:

1. Open **Manifests** in the sidebar, then click **Register New**.
2. Paste your YAML, upload a `.osc.yaml` / `.json` / `.csv` file, or
   use the Visual Builder.
3. Pick the target platform (Windows or Linux). The editor's
   validation adjusts accordingly.
4. Click **Register Manifest**.

You should see a success banner and the manifest in the list. If
you're authoring a Windows manifest on Linux (or vice versa), you'll
get a soft `warnings[]` entry instead of a hard error - that's by
design (see [Architecture → Registration semantics](../architecture/registration-semantics.md)).

To open the editor afterwards: **Manifests → click the manifest row**.
The detail/editor view loads with YAML / JSON / Visual Builder modes,
deploy/audit controls (gated on CLI presence), version history, and
the **Audit Pack** button in the Full edition.

## Confirm via CLI (optional)

If you have the OSConfig CLI installed and want to cross-check what
ConfigForge wrote into the namespace, open an elevated PowerShell
(or `sudo` shell on Linux):

```text
$ oscfg get namespace
hello

$ oscfg get resource -n hello
hello-cfs-registry  Microsoft.Windows/Registry  ...
```

> **Note:** `oscfg` doesn't always emit machine-readable output in
> the preview build. ConfigForge wraps the CLI to scrub the
> telemetry preamble and surface only the payload - see
> [Architecture → `oscfg` CLI contract](../architecture/oscfg-cli.md).

## Inspect the on-disk state

```text
~/.configforge/manifests/
├── hello.json              ← registration metadata
└── hello.source.yaml       ← lossless source manifest
```

The `.json` file holds the platform-detection result, resource
summary, and any soft warnings. The `.source.yaml` is the YAML you
posted; it's what the Export action returns and what the
[Audit-pack](../user-guide/audit-pack.md) embeds.

## Next steps

- Try the [editor](../user-guide/manifest-editor.md) to build a
  manifest from a form rather than YAML.
- Compare manifests on the [Diff page](../user-guide/matrix-diff.md):
  Pairwise, CIS Diff, or Matrix.
- Score a manifest against a CIS benchmark using
  [CIS Mapping](../user-guide/cis-compliance.md) (requires
  user-supplied CIS data files - see that page for setup).
- Install the OSConfig CLI from the
  [OSConfig CLI docs](https://github.com/microsoft/osconfig/tree/main/docs/cli)
  to light up Deploy / Audit / Revert in the Full edition.
