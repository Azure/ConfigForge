# ConfigForge Author 0.3.96-author.1 - macOS

> **Release state: draft and unpublished.** `mac-v0.3.96-author.1` is the
> current macOS Author tagged source. Its matching GitHub release remains an
> unpublished draft until a maintainer verifies the five expected assets and
> approves publication.

This release preserves the complete Windows Server 2025 baseline catalog and
hardens Machine Configuration MOF export. It remains an author-only Apple
Silicon build and does not add device deployment, device audit, enforcement,
revert, elevation, OSConfig CLI health, or audit-results storage.

## Windows Server 2025 baseline rebuild

- Preserve every shipped control and its ordering:
  - Member Server: 320 resources
  - Domain Controller: 321 resources
  - Workgroup Member: 296 resources
- Use canonical `REG_*` Registry types and colon-qualified hive paths.
- Replace five CSP controls with reviewed Registry-provider mappings.
- Keep five Policy CSP controls on writable `Config` paths instead of
  read-only `Result` paths.
- Translate the existing compliance schemas to CEL expressions without
  weakening ranges or dropping resources.
- Keep explicit desired values for the two Workgroup zero-valued Registry
  controls so exported manifests remain remediating.

## Machine Configuration MOF export

- Apply the MOF conversion fix to every baseline exported by ConfigForge, not
  only the WS2025 catalog.
- Emit `ModuleName = "Microsoft.OSConfig"` and a portable
  `ModuleVersion = "0.0.0"` placeholder for package-time version resolution.
- Emit one shared correlation-group GUID plus canonical `Value`, `ValueName`,
  and `ValueType` fields.
- Preserve empty-string desired values through the Microsoft.OSConfig fallback
  path.
- Default the public packaging documentation to Audit while
  Microsoft.OSConfig 1.3.11 retains its upstream remediation serialization
  defect.

## Included authoring capabilities

- YAML, JSON, MOF, CSV, and Visual editing with validation
- Microsoft Baselines and local, URL, CSV, JSON, YAML, and XLSX import
- Pairwise, CIS, and Matrix Diff
- User-supplied Benchmark Mapping data
- History and rationale capture
- Audit Pack PDF and Markdown export

Audit Pack generation is an authoring and export feature. It does not perform
a device audit.

## Author-only boundary

The macOS preload intentionally omits:

- `health`, `deploy`, `deployRecovery`, and `revert`
- `auditResults`
- `system` elevation methods

No `oscfg` binary or device-operation surface is included.

## Architecture

The release targets Apple Silicon ARM64 Macs (M1 or later). It is not an x64
or universal build and does not support Intel Macs. Builds are unsigned and
not notarized.

## Validation

- Main and mac WS2025 YAML structures are identical.
- Targeted MOF/catalog tests: 37 passed.
- Public packaging guard tests: 8 passed.
- PR #105 passed lint, full Vitest, Playwright Electron smoke, CodeQL, docs,
  and policy checks.
- The matching Workgroup baseline applied successfully on Windows Server 2025
  and audited 296/296 compliant in the exact baseline state.

## Expected draft release assets

The macOS release workflow uses exactly these expected asset names for
`mac-v0.3.96-author.1`:

1. `ConfigForge-Author-0.3.96-author.1-mac-arm64.dmg`
2. `ConfigForge-Author-0.3.96-author.1-mac-arm64.dmg.blockmap`
3. `latest-mac.yml`
4. `sbom-macos-author.cdx.json`
5. `SHA256SUMS-macos-author.txt`

## Contributors

PRs #104 and #105 were contributed by
[@ABMFST](https://github.com/ABMFST) with Copilot collaboration.

## Reporting issues

File issues in [Azure/ConfigForge](https://github.com/Azure/ConfigForge/issues)
with the `mac-author` label.
