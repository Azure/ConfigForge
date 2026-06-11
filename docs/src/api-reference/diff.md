# `cfs.diff.*` - N-way matrix diff

> **Phase 10 transport note.** Was `/api/diff/matrix` + `/api/diff/matrix.xlsx`.
> Same pure handlers, now over IPC. The pairwise diff surface was
> retired; pairwise diff is rendered client-side from
> [`cfs.exportChannel.get({ name, format: 'yaml' })`](./history-import-export.md)
> on both sides.

## `cfs.diff.matrix(names)` - channel `cfs:diff:matrix`

N-way master matrix. 2–10 manifest names per call, comma-separated
(case-insensitive dedup). Cap exported as `MAX_BASELINES = 10` from
`packages/core/src/handlers/diff-matrix.ts`; exceeding it returns 400.
Missing manifests are surfaced via `missing` and excluded; if fewer
than 2 are registered, the handler throws 400 with `data.missing`.

```ts
type MatrixCell = {
  value: unknown;
  status: 'identical' | 'differs' | 'missing';
  fromTestWrapper?: true;
};

type MatrixRow = {
  key: string;                       // e.g. "Microsoft.Windows/Registry:HKLM\\…\\MaxAuthTries"
  type: string;
  name: string;
  valueName?: string;
  keyPath?: string;
  values: Record<string, MatrixCell>;
  status: 'identical' | 'differs' | 'partial';
};

type DiffMatrixResult = {
  baselines: string[];               // names present, in dedup order
  missing: string[];                 // names requested but not registered
  matrix: MatrixRow[];
  stats: { identical: number; differs: number; partial: number; totalRows: number };
};

const result = await cfs.diff.matrix('ws2025-baseline,defender-prod,ssh-hardened');
```

### Row + cell statuses

| Row `status` | Meaning |
| --- | --- |
| `identical` | All present cells agree. |
| `differs` | At least two present cells disagree. |
| `partial` | Setting present in some baselines, missing in others. |

Cell `status` is one of `identical`, `differs`, or `missing`. A cell
may also carry `fromTestWrapper: true` when the resource is wrapped in
`Microsoft.OSConfig/Test` - the inner enforcement value is compared,
not the wrapper.

The reference for `identical` vs `differs` is the **first non-empty cell**
in the row, not necessarily the leftmost manifest. `keyPath` and
`valueName` are populated when the row's underlying type carries them.

### Errors

| Status | When |
| --- | --- |
| 400 | Fewer than 2 distinct names. |
| 400 | More than 10 names (`MAX_BASELINES = 10`). |
| 400 | Fewer than 2 of the requested manifests are registered - envelope includes `missing: string[]`. |

## `cfs.diff.matrixXlsxSave(names)` - channel `cfs:diff:matrix-xlsx:save`

Same data, written to disk as an Excel workbook with conditional
formatting. The renderer triggers a native save dialog (no HTTP
download). Pure handler: `buildMatrixXlsx` in
`packages/core/src/handlers/matrix-xlsx.ts`.

- `identical` cells: green fill (`#C6EFCE`).
- `differs` cells: red fill (`#FFC7CE`).
- `partial`/`missing` cells: amber fill (`#FFEB9C`).

Single `Matrix` sheet, columns
`Type | Setting | KeyPath | Status | <baseline-1> | <baseline-2> | …`.
Same 10-baseline cap (`MATRIX_XLSX_MAX_BASELINES = 10`).

## See also

- [User Guide - Matrix diff](../user-guide/matrix-diff.md)
- [User Guide - AI provenance](../user-guide/ai-provenance.md)
- [API Reference - `cfs.exportChannel.*`](./history-import-export.md)

## `cfs.cis.bulkLookup(namespace, benchmarkFilename?)` - channel `cfs:cis:bulk-lookup`

> **Added in v0.3.x.** Powers the CIS Diff tab on the Diff page.

The preload method accepts a manifest namespace and an optional benchmark
filename. It sends `{ namespace, benchmarkFilename }` over IPC, scans the
registered manifest source, auto-picks a platform-matched CIS benchmark
when one is not supplied, and returns both benchmark coverage metrics and
per-resource match details.

```ts
type CisBulkLookupResponse = {
  namespace: string;
  manifestResourceTotal: number;
  manifestResourcesWithMatch: number;
  benchmark: {
    filename: string;
    name: string;
    version: string;
    platform: 'windows' | 'linux' | 'unknown';
    totalRules: number;
    source: 'azure-policy' | 'xccdf';
  } | null;
  cisRulesCovered: number;
  cisRulesUnmatched: Array<{
    ruleId: string;
    sectionNumber: string;
    title: string;
    value: string;
  }>;
  compliancePercent: number | null;  // covered benchmark rules / total benchmark rules
  results: Array<{
    resourceName: string;
    resourceType: string;
    innerType: string;
    registryKeyPath: string | null;
    registryValueName: string | null;
    cisMatch: {
      ruleId: string;
      title: string;
      description?: string;
      severity?: string;
      source?: string;
      benchmark?: string;
      fixtext?: string;
      confidence?: string;
    } | null;
  }>;
};
```
