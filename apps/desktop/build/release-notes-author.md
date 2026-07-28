# ConfigForge Author 0.3.97-author.1 - macOS

> **Release state: draft and unpublished.** `mac-v0.3.97-author.1` is the
> current macOS Author tagged source.

This release keeps the complete WS2025 baseline and Machine Configuration
export fixes from 0.3.96 while restoring detailed compliance explanations.

## Detailed compliance reasons

- Preserve the authoritative reason returned by `oscfg` for expression-backed
  Test resources instead of replacing it with a generic pass/fail sentence.
- Add human-readable `{value}` templates to all 320 Member Server, 321 Domain
  Controller, and 296 Workgroup Member controls.
- Direct CLI and ConfigForge audits now report messages such as:
  `The value 3 must be one of 5, (not set).`

## Author-only boundary

The macOS preload still excludes device deployment, device audit, enforcement,
revert, elevation, CLI health, and audit-results storage. MOF and baseline
authoring/export remain available.

## Expected draft release assets

1. `ConfigForge-Author-0.3.97-author.1-mac-arm64.dmg`
2. `ConfigForge-Author-0.3.97-author.1-mac-arm64.dmg.blockmap`
3. `latest-mac.yml`
4. `sbom-macos-author.cdx.json`
5. `SHA256SUMS-macos-author.txt`
