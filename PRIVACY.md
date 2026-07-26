# Privacy

## ConfigForge data practices

ConfigForge sends no product telemetry, analytics, crash reports, or diagnostic
data to ConfigForge maintainers or Microsoft. Baselines, history, rationale,
comparisons, and exports that you create locally remain on your device unless
you explicitly upload or share them elsewhere. Application and updater logs also
remain local and are not uploaded by ConfigForge.

## Network requests

ConfigForge can make these user-facing network requests:

- **Update checks and downloads:** In supported packaged builds, the optional
  auto-updater contacts GitHub Releases shortly after startup and when the user
  requests another update check. An update download starts only after the user
  selects **Download**. As with any HTTPS request, GitHub and network operators
  can observe inherent connection metadata such as the source IP address,
  request time, user-agent headers, and requested repository or asset path. The
  requested feed or asset can also indicate the ConfigForge version, operating
  system, and processor architecture. ConfigForge does not include authored
  content in these requests. GitHub handles this data under the
  [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
- **User-requested external content:** Importing a baseline from a public URL
  sends a normal HTTPS request to that URL. Opening an external documentation
  link sends a request through your default browser. Those providers apply
  their own privacy terms.

## Separately installed OSConfig CLI

ConfigForge does not bundle the `oscfg` command-line interface (CLI). If you
install it separately and use Full-edition Deploy, Audit, or Revert features,
ConfigForge starts that external tool locally. `oscfg` may display a notice
that it sends required diagnostic data. Any collection by `oscfg` is governed
by the OSConfig and Microsoft privacy terms, not by ConfigForge. Review the
[OSConfig repository](https://github.com/microsoft/osconfig) and the
[Microsoft Privacy Statement](https://privacy.microsoft.com/privacystatement)
before using those device-operation features.
