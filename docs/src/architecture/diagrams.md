# Diagrams

Reference diagrams for the current Electron + `@configforge/core` architecture. They cover request flow, registration/deploy states, AI provenance, and CIS lookup.

Diagrams render via the `mdbook-mermaid` preprocessor; both the
preprocessor version and the release tarball SHA256 are pinned in
`.github/workflows/docs.yml` (CF-SEC-009).

## Request flow

A renderer action crosses the preload bridge, enters Electron main IPC, then calls pure core handlers. Deploy/audit handlers use the upstream `oscfg` CLI through the core wrapper.

```mermaid
flowchart LR
  Renderer["Renderer<br/>(React + FluentUI v9)<br/>apps/desktop/src/"]
  Preload["Preload bridge<br/>window.cfs.*<br/>apps/desktop/electron/preload.ts"]
  Main["Electron main<br/>ipc-handlers.ts<br/>+ ipc-validators.ts"]
  Handlers["Core handlers<br/>packages/core/src/handlers/"]
  OscfgLib["oscfg wrapper<br/>packages/core/src/oscfg/"]
  CLI["oscfg binary<br/>(upstream BYO CLI)"]
  SystemLib["System dispatch<br/>packages/core/src/system/"]
  HistoryLib["History store<br/>packages/core/src/history/"]
  FS["~/.configforge/"]

  Renderer -->|cfs.X.method| Preload
  Preload -->|ipcRenderer.invoke| Main
  Main --> Handlers
  Handlers --> OscfgLib
  OscfgLib --> CLI
  Handlers --> SystemLib
  SystemLib -->|PowerShell / Bash| OS[(OS)]
  Handlers --> HistoryLib
  HistoryLib --> FS
```

> `packages/core/src/oscfg/runner.ts` is the operational CLI spawn choke point. Renderer code has no `child_process` access.

## Registration state machine

What a manifest can become and how the transitions happen.
`Authored` is the case where someone runs `oscfg apply` out-of-band;
ConfigForge picks them up via `oscfg get namespace` during the list
call when `{ live: true }` is passed.

```mermaid
stateDiagram-v2
  [*] --> Authored: oscfg apply (out-of-band)
  [*] --> Registered: cfs:manifests:register
  Registered --> Registered_Deployed: cfs:deploy:run (mode=enforce)
  Registered_Deployed --> Registered_Audited: cfs:deploy:run (mode=audit)
  Registered_Deployed --> Registered: cfs:revert:apply
  Registered --> Removed: cfs:manifests:delete
  Registered_Deployed --> Removed: cfs:manifests:delete
```

> **Note:** `Authored` namespaces (CLI-visible but not registered)
> still appear in the list when called with `{ live: true }`. They
> go through `oscfg get resource` on demand rather than the
> disk-based fast path. Every CLI-gated transition above also has
> the v0.2.0 `CLI_REQUIRED` preflight in front of it. Deploy /
> Audit / Revert open `<CliRequiredModal />` instead of running
> when `oscfg` is missing.

## AI provenance + circular-guard

The diff analysis is a local heuristic (no LLM/network). Each element
of the retrieval chain contributes a heuristic citation, and `Apply`
is hidden until a citation-coverage threshold is met. AI-generated
output is **labeled** with a marker (`<!-- ai-generated:rev=N -->`)
plus a spoof-resistant per-process FNV-1a 64-bit content-hash registry
(CF-SEC-007). Note: the marker is advisory — the `assertNotAiGenerated`
check is available in core but is **not currently wired** into
ingestion, so marked content is not auto-rejected today.

```mermaid
flowchart TD
  Q[User question] --> Retrieval{Retrieve grounding}
  Retrieval -->|CIS / NIST / MSDocs / GPO| Sources[(Sources with confidence)]
  Retrieval -->|Manifest content| Guard{Marker detected?<br/>advisory, not wired}
  Guard -->|yes| Flag[Flagged: re-fed AI<br/>advisory only, not blocked]
  Guard -->|no| Sources
  Flag --> Sources
  Sources --> Coverage{citationCoverage ≥ 0.5?}
  Coverage -->|yes| ShowApply[Apply visible]
  Coverage -->|no| Advisory[Advisory only: Apply hidden]
```

> **Warning:** A response with `sources: []` is **always** advisory.
> The Apply button is never visible without at least one cited
> source.

## CIS lookup flow

The CIS Mapping page and CIS Diff tab resolve manifest resources against user-supplied CIS data. XCCDF is preferred when available for full-standard coverage; Azure Policy JSON is a supported fallback/source.

```mermaid
flowchart TD
  Input["Manifest resource"] --> T1{JSON catalog match}
  T1 -->|hit| Result["CIS rule metadata"]
  T1 -->|miss| T2{XCCDF registry exact}
  T2 -->|hit| Result
  T2 -->|miss| T3{XCCDF non-registry indices}
  T3 -->|hit| Result
  T3 -->|miss| T4{XCCDF fuzzy title / CSP words}
  T4 -->|hit| Result
  T4 -->|miss| T5{Azure Policy JSON word match}
  T5 -->|hit| Result
  T5 -->|no match| Unmatched["Unmatched"]

  subgraph "Runtime CIS data directory"
    JSON["*.json legacy catalogs<br/>packages/core/src/cis/data.ts"]
    XML["*.xml XCCDF+OVAL<br/>packages/core/src/cis/xccdf-parser.ts"]
    Policy["Azure Policy JSON<br/>packages/core/src/cis/azure-policy-cis.ts"]
  end

  T1 -.-> JSON
  T2 -.-> XML
  T3 -.-> XML
  T4 -.-> XML
  T5 -.-> Policy
```

> The resolved CIS data directory is `<repo>/public/_baselines/cis/_data/` in dev and `<process.resourcesPath>/public-assets/_baselines/cis/_data/` in packaged builds.

## See also

- [Architecture → System overview](./system-overview.md)
- [Architecture → Registration semantics](./registration-semantics.md)
- [User Guide → AI analysis with provenance](../user-guide/ai-provenance.md)
