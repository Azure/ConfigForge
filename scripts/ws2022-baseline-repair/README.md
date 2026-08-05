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
with a template that says so), and every assertion that was downgraded from a
real constraint is listed in `conversion-report.json` under
`assertionDowngrades` with its reason.

## Files

| File | Purpose |
| --- | --- |
| `csp-provider-map.json` | 81 reviewed CSP-path → dedicated-provider mappings, extracted from the WS2025 repair commit. Targets are **address only** — no WS2025 desired values. |
| `schema-expression-map.json` | 49 reviewed legacy-schema → CEL `expression`/`template` translations, keyed by (schema shape, value kind). |
| `conversion-report.json` | Per-rule provenance for the shipped YAML: source values, converted CSP paths, expansions, value reshapes and assertion downgrades. Committed because CI checks out shallow, so tests cannot read pre-repair history. |
| `derive-maps.mjs` | Regenerates the two mapping tables from the pinned evidence commits. Proves the tables are extraction, not invention. |
| `repair-ws2022-baselines.mjs` | The converter. Reads the pre-repair profiles from the pinned source commit and writes `public/_baselines/ws2022-*.osc.yaml` plus `conversion-report.json`. |
| `repair-ws2022-baselines.test.mjs` | Unit coverage for the mapping tables and normalisers. |

Shipped-YAML assertions (counts, provider payload validity, rule parity,
desired-value preservation) live in
`apps/desktop/src/data/ws2022-baselines.test.ts`.

## Evidence commits

| Ref | What it provides |
| --- | --- |
| `50d469c` (and `50d469c^`) | WS2025 CSP → dedicated provider conversion. Source of `csp-provider-map.json`. |
| `6fb3052` (and `6fb3052^`) | WS2025 `schema:` → `expression:`/`template:`, colon hives, `REG_*` value types. Source of `schema-expression-map.json`. |
| `173177e` | Last commit carrying the original generated WS2022 profiles. Pinned conversion input. |

## Re-running

```bash
# Verify the mapping tables still match the evidence commits
node scripts/ws2022-baseline-repair/derive-maps.mjs --check

# Verify the shipped baselines still match the deterministic conversion
node scripts/ws2022-baseline-repair/repair-ws2022-baselines.mjs --check

# Regenerate (writes public/_baselines/ws2022-*.osc.yaml + conversion-report.json)
node scripts/ws2022-baseline-repair/repair-ws2022-baselines.mjs

# Human-readable summary of what the conversion did
node scripts/ws2022-baseline-repair/repair-ws2022-baselines.mjs --report
```

Both scripts require full git history (they read the pinned evidence commits),
so they are maintainer tools, not CI steps. The vitest suites read only
committed files.

## Result

| Profile | Rules before → after | CSP before → after | keyPaths normalised | Shape repairs | Assertion downgrades |
| --- | --- | --- | --- | --- | --- |
| `ws2022-domain-member` | 257 → 259 | 73 → 0 | 184 | 5 | 7 |
| `ws2022-domain-controller` | 242 → 244 | 71 → 0 | 171 | 4 | 6 |
| `ws2022-workgroup-member` | 200 → 202 | 71 → 0 | 129 | 3 | 7 |

The +2 rule delta per profile is the composite `AccountLockoutPolicy` CSP
string expanding into three separate `AccountPolicy` rules
(`LockoutDuration`, `LockoutThreshold`, `LockoutReset`), matching the WS2025
suffix convention.

## Known limitations

- **OSConfig security baseline support is officially Windows Server 2025 only.**
  WS2022 remains best-effort. The repaired profiles use the same providers the
  WS2025 baselines ship with, but Microsoft does not support the OSConfig
  security baseline scenario on WS2022.
- **No hardware validation was performed for WS2022.** The WS2025 repair was
  validated on a Server 2025 host; the WS2022 conversion inherits that
  provider evidence but has not itself been run against a live WS2022 machine.
- **All 36 `UserRightsAssignment` rules are informational** (`expression:
  'true'`). This matches shipped WS2025, where all 39 are informational. Of
  those, 7 (6 on the domain controller) were downgraded from a scalar
  `{"oneOf":[{"const":""},{"type":"null"}]}` schema that no longer applies once
  the provider requires a principal list. They are listed in
  `conversion-report.json`; a list-equality CEL form is unproven in this
  codebase and an expression error would recreate the original "unread"
  symptom.
- **The `{maximum: N}` CEL form has no golden WS2025 precedent.** It is the
  symmetric counterpart of the reviewed `{minimum: N}` form.
- **A small number of Registry rules carry no desired value** (read-only or
  informational upstream). Their addressing is repaired; their assertion stays
  informational.
