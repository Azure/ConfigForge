# ConfigForge Author 0.3.101-author.1 - macOS

> **Release state: prerelease.**

This release brings the author-safe Windows Server baseline, lossless data,
Machine Configuration packaging, build compatibility, and dependency security
updates from the 0.3.101 Full-edition line to Apple Silicon Macs.

## Added

- Added a fail-closed Azure Machine Configuration package helper that patches
  both packaged Microsoft.OSConfig 1.4.3 Set wrappers to pass resource
  properties as compressed JSON.

## Fixed

- Repaired the Windows Server 2022 Member Server, Domain Controller, and
  Workgroup Member baselines for standalone authoring and Machine
  Configuration export.
- Preserved exact QWord values and canonical Registry contracts across YAML,
  JSON, spreadsheets, Visual mode, Diff, reports, registration, and MOF
  export.
- Serialized overlapping history-retention and rationale writes.
- Supported source builds on Node 22.12 and Node 24.

## Security

- Updated js-yaml to 4.3.1, DOMPurify to 3.4.13, fast-uri to 3.1.5,
  ip-address to 10.4.0, React Router to 7.18.2, Undici 6.x to 6.28.0, and
  Undici 7.x to 7.29.0.

## Author-only scope

- Device deploy, audit, enforce, revert, elevation, health, and audit-results
  storage remain intentionally excluded.

## Expected assets

1. `ConfigForge-Author-0.3.101-author.1-mac-arm64.dmg`
2. `ConfigForge-Author-0.3.101-author.1-mac-arm64.dmg.blockmap`
3. `latest-mac.yml`
4. `sbom-macos-author.cdx.json`
5. `SHA256SUMS-macos-author.txt`
