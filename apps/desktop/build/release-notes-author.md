# ConfigForge Author 0.3.104-author.1 - macOS

> **Release state: prerelease.**

This maintenance release brings the merged baseline-template repairs,
security updates, and clearer customer guidance to Apple Silicon Macs.

## Changed

- Start with the correct download and a first saved baseline. Advanced
  comparison, benchmark, reporting, and packaging workflows remain optional.
  ([#143](https://github.com/Azure/ConfigForge/pull/143))
- Creating Machine Configuration packages requires the
  **Microsoft.OSConfig PowerShell module 1.4.10+** on a separate compatible
  packaging machine. PowerShell 7 and GuestConfiguration are distinct
  prerequisites. Do not apply the historical 1.4.3 package patch to newer
  modules. See the [packaging guide](https://azure.github.io/ConfigForge/user-guide/machine-configuration.html).

## Fixed

- Include the reviewed Windows Server 2016-2025 template repairs for
  authoring and export, including effective firewall defaults and
  non-mutating account-policy checks.
  ([#120](https://github.com/Azure/ConfigForge/pull/120))

## Security

- Ship the reviewed dependency updates, including Electron 42.11.3,
  DOMPurify 3.4.16, and js-yaml 4.3.2.
  ([#132](https://github.com/Azure/ConfigForge/pull/132),
  [#141](https://github.com/Azure/ConfigForge/pull/141))
- Include a SHA-256 manifest and CycloneDX software bill of materials.
  Development-only advisories remain tracked separately; the entire
  development dependency tree is not claimed to be advisory-free.

## Author-only scope

- Device deploy, audit, enforce, revert, elevation, health, and audit-results
  storage remain intentionally excluded.
- Apple Silicon ARM64 only; no Intel or universal build. Authoring, Diff,
  Benchmark Mapping, history, rationale, and Audit Pack exports remain available.

## Important limits

ConfigForge remains experimental, community-maintained, not an officially
supported Microsoft product, and not intended for production use. This
download is **unsigned and not notarized**. Verify its SHA-256 and follow your
organization's software policy; a checksum is not proof of publisher identity
or safety. Back up your work before upgrading. Existing baseline data is not
automatically replaced by bundled template updates.

## Expected assets

1. `ConfigForge-Author-0.3.104-author.1-mac-arm64.dmg`
2. `ConfigForge-Author-0.3.104-author.1-mac-arm64.dmg.blockmap`
3. `latest-mac.yml`
4. `sbom-macos-author.cdx.json`
5. `SHA256SUMS-macos-author.txt`

[Full changes](https://github.com/Azure/ConfigForge/compare/mac-v0.3.101-author.1...mac-v0.3.104-author.1)
