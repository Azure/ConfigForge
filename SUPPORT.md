# Support

## Best-effort community support

ConfigForge is an experimental, community-maintained project. It is provided
as-is for experimentation, learning, and community contribution. It is not an
officially supported Microsoft product and has no response-time or resolution
service-level agreement.

The current repository maintainer is
[@ABMFST](https://github.com/ABMFST). Repository ownership is also recorded in
[`.github/CODEOWNERS`](./.github/CODEOWNERS).

Maintainers review issues and pull requests on a best-effort basis. Response
time depends on availability, reproducibility, project scope, and community
participation.

## Request help or report a defect

1. Review [`README.md`](./README.md), [`INSTALL.md`](./INSTALL.md), and the
   documentation under [`docs/src`](./docs/src).
2. Search existing [GitHub Issues](https://github.com/Azure/ConfigForge/issues).
3. Use the bug or feature issue form. Include the ConfigForge version, edition,
   operating system, reproduction steps, and sanitized diagnostics.

Do not include credentials, personal data, private configuration, or licensed
CIS benchmark content. Redact logs and screenshots before attaching them.

## Security and upstream components

- Report security vulnerabilities privately as described in
  [`SECURITY.md`](./SECURITY.md).
- ConfigForge does not bundle `oscfg`. Problems that reproduce in the
  separately installed CLI should follow the
  [Microsoft OSConfig repository](https://github.com/microsoft/osconfig)
  guidance.
- Questions about GitHub, Electron, operating systems, or third-party
  dependencies may need to be handled by those upstream projects.
