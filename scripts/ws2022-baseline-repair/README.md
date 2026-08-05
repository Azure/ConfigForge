# WS2022 baseline repair

Deterministic, evidence-backed repair of the three bundled Windows Server 2022
security baselines in `public/_baselines/`:

- `ws2022-domain-member.osc.yaml`
- `ws2022-domain-controller.osc.yaml`
- `ws2022-workgroup-member.osc.yaml`

## Why

The WS2022 baselines shipped in their original generated form. Roughly 30% of
each profile (71–73 rules) addressed audit policy, user rights and account
policy through `Microsoft.Windows/CSP` at `./Vendor/MSFT/Policy/Result/...`.
That address only resolves through OMA-DM, so on a standalone (non-MDM) server
those settings come back **unread** instead of compliant/non-compliant. The
same profiles also used colon-less registry hive prefixes
(`HKEY_LOCAL_MACHINE\...`), legacy value-type aliases (`Dword`, `String`,
`MultiString`) and ambiguous `schema: {}` compliance blocks.

WS2025 hit the identical defect and was repaired in PRs #82 and #93 by moving
each control onto a dedicated provider. This change applies the same, already
reviewed, mechanism to WS2022.

## Conversion policy

The WS2022 **desired value is authoritative**. Only the *mechanism* and
*addressing* are borrowed from WS2025. Preference order:

1. `Microsoft.Windows/Registry` when the rule already had a registry donor.
2. `Microsoft.Windows/AuditPolicy` using the exact subcategory GUID.
3. `Microsoft.Windows/UserRightsAssignment` using the exact `Se*` right name.
4. `Microsoft.Windows/AccountPolicy` using the exact policy name.
5. Keep CSP only when no defensible dedicated mapping exists.

Residual CSP after this change: **0 rules in all three profiles.**

Ambiguous `schema: {}` blocks are never turned into an invented security
assertion. They become the WS2025 informational form (`expression: 'true'`
with a template that says so). Nothing is left as a silent downgrade:
`conversion-report.json` records every `assertionRestatement` and
`assertionDowngrade`. **After this change `assertionDowngrades` is empty in all
three profiles.**

### Restored assertions (user rights that must be unassigned)

7 rules per member profile (6 on the domain controller) carried the scalar
schema `{"oneOf":[{"const":""},{"type":"null"}]}` with a desired value of `""`
— i.e. *"this right must be granted to nobody"*. Because
`Microsoft.Windows/UserRightsAssignment` reads back a **list of principals**,
that scalar schema cannot be applied verbatim; it is restated over the list:

```yaml
expression: value == null || value.size() == 0
template: The value {value} must be unassigned (no principals).
```

`||` short-circuits in CEL, so `size()` is never applied to an unset value.
`size()` on a `UserRightsAssignment` principal list is already exercised in
this repo (`packages/core/src/import-export/index.test.ts`, `expression:
'value.size() == 2'`). The rules are:

`UserRightsAccessCredentialManagerAsTrustedCaller`,
`UserRightsActAsPartOfTheOperatingSystem`,
`UserRightsCreatePermanentSharedObjects`, `UserRightsCreateToken`,
`UserRightsEnableDelegation` (member profiles only), `UserRightsLockMemory`,
`UserRightsModifyObjectLabel`.

`translatePrincipalListSchema()` returns `null` for any other shape, so an
unreviewed schema still surfaces as an explicit downgrade rather than being
silently reinterpreted.

## Files

| File | Purpose |
| --- | --- |
| `csp-provider-map.json` | 81 reviewed CSP-path → dedicated-provider mappings, extracted from the WS2025 repair commit. Targets are **address only** — no WS2025 desired values. |
| `schema-expression-map.json` | 49 reviewed legacy-schema → CEL `expression`/`template` translations, keyed by (schema shape, value kind). |
| `conversion-report.json` | Per-rule provenance for the shipped YAML: source values, converted CSP paths, expansions, value reshapes, assertion restatements and downgrades, plus the live smoke result. Committed because CI checks out shallow for most jobs. |
| `derive-maps.mjs` | Regenerates the two mapping tables from the pinned evidence commits (both before *and* after states come from `git show`, never the working tree). Proves the tables are extraction, not invention. |
| `repair-ws2022-baselines.mjs` | The converter. Reads the pre-repair profiles from the pinned source commit and writes `public/_baselines/ws2022-*.osc.yaml` plus `conversion-report.json`. `--check` and `--report` are both read-only. |
| `repair-ws2022-baselines.test.mjs` | Unit coverage for the mapping tables and normalisers. Re-derives every mapping claim from the pinned commits rather than trusting the committed tables. |

Shipped-YAML assertions (counts, provider payload validity, rule parity,
desired-value preservation) live in
`apps/desktop/src/data/ws2022-baselines.test.ts`.

## Evidence commits

Every artifact is loaded with `git show <full 40-char SHA>:<path>`. The working
tree is never read, and abbreviated SHAs, branch names and `HEAD` are all
rejected, because they are mutable. `derive-maps.mjs` verifies before it derives
anything that each pinned SHA resolves to itself and is an **ancestor of
`origin/main`**; `repair-ws2022-baselines.test.mjs` asserts the same pins and
the same ancestry.

| Role | Full SHA | What it provides |
| --- | --- | --- |
| `providerBeforeCommit` | `ab71aaf778a87322899a671e6d06bce0fa40aa2a` | WS2025 in its generated `./Vendor/MSFT/Policy/Result/...` CSP form. |
| `providerAfterCommit` | `50d469c3cf5e16729f1359538b10ef4bc0b6de78` | *fix(baselines): repair WS2025 standalone audits* — CSP moved onto dedicated providers. Source of `csp-provider-map.json`. |
| `schemaBeforeCommit` | `50d469c3cf5e16729f1359538b10ef4bc0b6de78` | Same commit: dedicated providers, legacy `schema:` compliance blocks. |
| `schemaAfterCommit` | `37ab26a74bd7a6aa7f6df9a6ecc0fba3a7521821` | *fix(compliance): preserve CLI Test reasons* — `schema:` replaced by `expression:` + `template:`. Source of `schema-expression-map.json`. |
| `ws2022SourceCommit` | `173177e9eaa34d0b910b44d0749192859831fd50` | Last commit carrying the original generated WS2022 profiles. Pinned conversion input. |

The overlap is deliberate: `50d469c` is the *after* state for the provider
mapping and the *before* state for the schema translation, which is exactly how
the two reviewed changes were layered onto `main`.

## Re-running

```bash
# Verify the mapping tables still match the evidence commits
node scripts/ws2022-baseline-repair/derive-maps.mjs --check

# Verify the shipped baselines still match the deterministic conversion
node scripts/ws2022-baseline-repair/repair-ws2022-baselines.mjs --check

# Human-readable summary of what the conversion did — READ-ONLY, writes nothing
node scripts/ws2022-baseline-repair/repair-ws2022-baselines.mjs --report

# Regenerate (writes public/_baselines/ws2022-*.osc.yaml + conversion-report.json).
# Writing happens only when neither --check nor --report is given.
node scripts/ws2022-baseline-repair/repair-ws2022-baselines.mjs
```

Both scripts require full git history (they read the pinned evidence commits).
The vitest suites read committed files for their core assertions; the
evidence-re-derivation tests additionally need history, which is why the CI
`test` job checks out with `fetch-depth: 0`. Those tests skip on a shallow
local clone but are **mandatory whenever `CI` is set**.

## Result

| Profile | Rules before → after | CSP before → after | keyPaths normalised | Shape repairs | Assertion restatements | Assertion downgrades |
| --- | --- | --- | --- | --- | --- | --- |
| `ws2022-domain-member` | 257 → 259 | 73 → 0 | 184 | 5 | 7 | 0 |
| `ws2022-domain-controller` | 242 → 244 | 71 → 0 | 171 | 4 | 6 | 0 |
| `ws2022-workgroup-member` | 200 → 202 | 71 → 0 | 129 | 3 | 7 | 0 |

Per-profile providers after the repair:

| Profile | Registry | AuditPolicy | UserRightsAssignment | AccountPolicy |
| --- | --- | --- | --- | --- |
| `ws2022-domain-member` | 184 | 26 | 36 | 13 |
| `ws2022-domain-controller` | 171 | 32 | 28 | 13 |
| `ws2022-workgroup-member` | 129 | 26 | 36 | 11 |

## Live smoke evidence (not native WS2022 validation)

The `ws2022-workgroup-member` profile was executed with `oscfg`
**1.3.12-preview5** on a
**Windows Server 2025** host — *not* a Windows Server 2022 host:

| Baseline | Compliant | Non-compliant | Read errors |
| --- | --- | --- | --- |
| Shipped (pre-repair) | 171 | — | **29** |
| Repaired | **200** | 2 | **0** |

The 29 unreadable settings are exactly the symptom this change removes, and the
2 non-compliant results are genuine findings on that host rather than read
failures. **This is a mechanism check, not a Windows Server 2022 validation:**
the profile ran against a WS2025 machine, so the settings' *values* are not
meaningful for WS2022 and no conclusion about WS2022 support should be drawn
from it. The same numbers are recorded in `conversion-report.json` under
`_provenance.liveSmoke`, with the caveat inline.

The +2 rule delta per profile is the composite `AccountLockoutPolicy` CSP
string expanding into three separate `AccountPolicy` rules
(`LockoutDuration`, `LockoutThreshold`, `LockoutReset`), matching the WS2025
suffix convention.

## Known limitations

- **OSConfig security baseline support is officially Windows Server 2025 only.**
  WS2022 remains best-effort. The repaired profiles use the same providers the
  WS2025 baselines ship with, but Microsoft does not support the OSConfig
  security baseline scenario on WS2022.
- **No hardware validation was performed on Windows Server 2022.** See "Live
  smoke evidence" above: the repaired profile was executed on a Windows Server
  **2025** host, which proves the settings become readable but says nothing
  about WS2022 behaviour.
- **29 of 36 `UserRightsAssignment` rules are informational** (`expression:
  'true'`) — 22 of 28 on the domain controller. Their source carried an empty
  `schema: {}`, so there is no constraint to restate; this matches shipped
  WS2025, where all 39 user-rights rules are informational. The remaining
  7/6/7 rules are **not** downgraded: see "Restored assertions" below.
- **`UserRightsDenyAccessFromNetwork` keeps a real desired value but an
  informational assertion.** Its source schema was `{}`, so asserting the
  principal list would be an invented constraint.
- **The `{maximum: N}` CEL form has no golden WS2025 precedent.** It is the
  symmetric counterpart of the reviewed `{minimum: N}` form.
- **A small number of Registry rules carry no desired value** (read-only or
  informational upstream). Their addressing is repaired; their assertion stays
  informational.
