# `cfs.compliance.report` - CIS scoring

> **Phase 10 transport note.** Was `/api/compliance/report`.
> `packages/core/src/handlers/compliance-report.ts` now backs the
> `cfs:compliance:report` IPC channel. Contract preserved.

Score a registered manifest against a CIS baseline. Implementation in
`packages/core/src/cis/compliance.ts`; the handler glues it to the
host-injected baseline catalog.

> **Note:** Requires user-supplied CIS data files under the runtime's
> resolved public asset root (via `resolvePublicAsset()`) AND a matching
> `cis-benchmark` entry in the host-injected `BASELINE_CATALOG`.
> ConfigForge does **not** redistribute CIS Benchmark content
> (license restrictions); catalog entries that previously pointed at
> bundled CIS YAMLs have been removed. See
> [User Guide → CIS compliance](../user-guide/cis-compliance.md) to
> reintroduce them locally. Use `cfs.cis.status()` to gate UI; it
> returns availability, resolved data directory, expected-file diagnostics,
> discovered XCCDF files, and discovered Azure Policy CIS JSON files.

## `cfs.compliance.report({ manifest, against })` - channel `cfs:compliance:report`

`against` accepts any `id` from `BASELINE_CATALOG` whose `category` is
`cis-benchmark` and whose `source` is `'local'` with a populated
`manifestUrl`. Out of the box no such entries exist -
populating them is part of the user-side enable step.

```ts
type ComplianceResponse = {
  manifest: string;
  against: string;
  baselineName: string;
  generatedAt: string;
  report: {
    matched: number;
    mismatched: number;
    missing: number;
    score: number;          // round(matched / total * 100)
    total: number;          // CIS baseline rule count (not matched+mismatched+missing)
    severityBreakdown: Record<string,
      { matched: number; mismatched: number; missing: number }>;
    perRule: Array<{
      ruleName: string;
      type?: string;
      status: 'matched' | 'mismatched' | 'missing';
      myValue?: unknown;
      expected?: unknown;
      severity: string;       // e.g. "High" or "Unknown", depending on local CIS data
      gpoPath?: string | null;
      ruleId?: string;
    }>;
    extras: Array<{ ruleName: string; type?: string }>;  // informational - does NOT lower score
  };
};
```

`extras[]` are settings present in the user manifest but not in the CIS
baseline - informational only.

## Caching

`createCachedDedup` (`packages/core/src/handlers/cache.ts`) - 5-minute
TTL keyed by `${namespace}::${baselineId}` with in-flight dedup.
Re-registering the manifest invalidates downstream.

## Errors

| Status | When |
| --- | --- |
| 400 | Missing `manifest` / `against`; catalog entry not `cis-benchmark`; no local `manifestUrl`; resolved path escapes the public asset root. |
| 404 | Manifest not registered, or `against` id not in `BASELINE_CATALOG`. |
| 422 | User manifest YAML failed to parse. |
| 500 | Could not read baseline file, or CIS YAML parse failed. |

Call `cfs.cis.status()` first to gate UI.

```ts
type CisStatus = {
  available: boolean;
  dataDir?: string;
  files?: Array<{ name: string; present: boolean; description: string; required: boolean }>;
  unexpectedFiles?: Array<{ name: string; didYouMean: string | null }>;
  schemaError?: string | null;
  source?: 'json' | 'xccdf' | 'both';
  xccdfFiles?: Array<{
    filename: string;
    platform: 'windows' | 'linux' | 'unknown';
    product: string;
    version: string;
    title: string;
    hasOval: boolean;
  }>;
  azurePolicyCisFiles?: Array<{
    filename: string;
    platform: 'windows' | 'linux' | 'unknown';
    benchmarkName: string;
    benchmarkVersion: string;
    ruleCount: number;
  }>;
};
```

Library + ManifestEditor pages already gate off this signal.

## See also

- [User Guide - CIS compliance](../user-guide/cis-compliance.md)
- [API Reference - `cfs.auditPack.*`](./audit-pack.md)
- [Architecture - Module map](../architecture/module-map.md)

## `cfs.cis.recheck()` - channel `cfs:cis:recheck`

> **Added in v0.3.2.** Force-refreshes all CIS data caches (status + global mappings) without an app restart. Pairs with the CIS Mapping page's "Re-check" button.

## `cfs.cis.revealDataDir()` - channel `cfs:cis:reveal-data-dir`

> **Added in v0.3.2.** Creates the CIS data directory if missing, opens it in the system file manager (Explorer / Finder), and invalidates the status cache.

## `cfs.cis.bulkLookup(namespace, benchmarkFilename?)` - channel `cfs:cis:bulk-lookup`

> **Added in v0.3.x.** Batch CIS rule lookup for the Diff page's CIS Diff tab. See [`cfs.diff.*`](./diff.md#cfscisbulklookupnamespace-benchmarkfilename--channel-cfscisbulk-lookup) for the full contract.
