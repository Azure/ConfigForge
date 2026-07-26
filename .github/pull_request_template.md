## Summary

Describe the user-facing problem and the focused change that addresses it.

## Testing

- [ ] Added or updated focused tests.
- [ ] Ran the relevant focused tests.
- [ ] Ran the full test, lint, and build gates, or explained why they were not run.

## Documentation

- [ ] Updated user, contributor, release, or operational documentation when behavior changed.
- [ ] Verified changed links, commands, and version references.

## Security and public readiness

- [ ] Added no secrets, personal data, licensed CIS content, or bundled `oscfg` binaries.
- [ ] Documented any new network, privilege, data-handling, dependency, or packaging behavior.

## Flavor and release flow

- [ ] Shared behavior targets `main` first and identifies the required `mac-author-build` cherry-pick or manual port.
- [ ] Flavor-specific changes preserve the macOS Author capability boundary.
- [ ] Package versions are unchanged unless this is an explicit release-preparation change.
