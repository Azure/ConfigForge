# Governance

## Project authority

ConfigForge is a community-maintained open-source project in the
[`Azure/ConfigForge`](https://github.com/Azure/ConfigForge) repository. The
current repository maintainer is [@ABMFST](https://github.com/ABMFST).

The maintainer has authority to:

- Triage issues and pull requests.
- Approve and merge changes.
- Manage repository collaborators and documented project policy.
- Create immutable release tags and draft releases.
- Publish a draft release after its assets, checksums, and software bill of
  materials (SBOM) have been reviewed.

Maintainer changes must be reflected in repository permissions,
`.github/CODEOWNERS`, and this document.

## Decisions and contributions

Technical decisions should be documented in the relevant issue, pull request,
or design document. Changes require review and must pass the applicable
automated checks. The maintainer resolves decisions when consensus is not
reached.

ConfigForge is provided as-is and is not an officially supported Microsoft
product. See [`SUPPORT.md`](./SUPPORT.md) and [`SECURITY.md`](./SECURITY.md).

## Branch and release flow

- `main` is the Windows and Linux Full-edition line. Shared behavior lands on
  `main` first.
- `mac-author-build` is the macOS Author-edition line. Reviewed shared commits
  are cherry-picked or manually ported from `main`.
- Do not cross-merge `main` and `mac-author-build`. Resolve package metadata,
  changelog, and flavor differences during the port.
- Flavor-specific changes may target `mac-author-build` directly when they do
  not apply to the Full edition.
- Pull requests and pushes to both active branches run `PR check`.
- Full releases use `vX.Y.Z`. macOS Author releases use
  `mac-vX.Y.Z-author.N`. Release tags are immutable, and publication remains a
  deliberate maintainer action after draft-asset verification.
