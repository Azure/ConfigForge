# Security Policy

## Supported versions

Security fixes are evaluated for the current tagged source lines.

| Edition | Current version | Security updates |
| --- | --- | --- |
| Full edition for Windows and Linux | `v0.3.95` | Supported tagged source; release remains a draft |
| macOS Author edition | `mac-v0.3.94-author.1` | Supported tagged source; release remains a draft |
| Older versions | Earlier tags | Not supported |

## Security scope

Report vulnerabilities in:

- ConfigForge source code and Electron security boundaries.
- Installer, update, release, and GitHub Actions behavior maintained in this
  repository.
- ConfigForge handling of local baselines, imports, exports, logs, or
  user-supplied content.
- A dependency vulnerability that is exploitable through ConfigForge.

Do not attach secrets, personal data, or licensed CIS benchmark content to a
report.

## Report a vulnerability

**Do not report security vulnerabilities through public GitHub issues.**

Submit reports through the
[Microsoft Security Response Center (MSRC) vulnerability portal](https://msrc.microsoft.com/report/vulnerability/new).
Identify the affected project as `Azure/ConfigForge` and include the version,
edition, operating system, impact, and minimum reproduction details.

Microsoft's current repository-wide security reporting guidance is available
at [aka.ms/SECURITY.md](https://aka.ms/SECURITY.md).

## Separately installed oscfg

ConfigForge does not bundle the `oscfg` command-line interface. If a problem
reproduces when `oscfg` is invoked directly and does not depend on ConfigForge,
route it to the upstream
[Microsoft OSConfig project](https://github.com/microsoft/osconfig).

- Report an `oscfg` security vulnerability through MSRC and identify OSConfig
  as the affected product.
- Follow the OSConfig repository's current guidance for non-security defects.
- Use a ConfigForge issue only when the vulnerability is caused by this
  repository's integration, validation, user interface, or packaging.
