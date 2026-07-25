# Intelligent Diff Insights

> **v0.3.48:** Intelligent Diff Insights is a local renderer/core
> feature. No OSConfig CLI required and no network required. It works
> identically in Editor mode (amber footer pill) and CLI-installed mode.
> AI rationale-assist is the only optional online feature.

The Intelligent Diff Insights panel explains a pairwise diff with a
locally-computed summary, risk badge, and source/provenance panel. The
analysis is a **local, deterministic heuristic** — there is no LLM or
network call. AI-adjacent responses carry a **provenance bundle** (a
heuristic list of sources with confidence scores), and AI-generated
output is **labeled** with a marker so it can be recognized if it is
ever fed back in.

This is a direct response to user research:

> *"AI primarily hallucinates… smart tool should have checks and
> balances."*
>
> *"AI can have circular reasoning… refer to a user's own documents
> when answering a net-new question."*

## What the analyzer returns

```ts
interface DiffAnalysis {
  // ... the diff explanation ...
  provenance: Provenance;
}

interface Provenance {
  sources: AiSource[];
  /** 0..1 — mean of per-source confidence (a heuristic label, not a
   *  verified-evidence measure); empty sources → 0. */
  citationCoverage: number;
}

interface AiSource {
  kind: 'CIS' | 'NIST' | 'MSDocs' | 'GPO' | 'manifest' | 'user-input';
  label: string;
  url?: string;
  confidence: number;   // 0..1
}
```

The analyzer populates `provenance`; local diff analysis attaches the
input manifests themselves as `kind: 'manifest'` sources with confidence
`1.0`. If a future analyzer returns `sources: []`, the UI treats it as
low confidence / advisory only.

## Confidence threshold

| Condition | UI behaviour |
| --- | --- |
| `sources.length === 0` | Sources panel: *"No sources cited. Advisory only."* Low-confidence banner shown. |
| `citationCoverage < 0.5` | Banner: *"Low confidence. Verify before applying."* |
| `0.5 ≤ citationCoverage < 0.8` | Sources panel shows citation coverage; user should verify. |
| `≥ 0.8` | Default UI. |

## Source kinds

| `kind` | Meaning | Typical URL |
| --- | --- | --- |
| `CIS` | A CIS Benchmark rule (looked up in user-supplied catalog data. See [Benchmark Mapping](./cis-compliance.md)). | CIS website permalink. |
| `NIST` | A NIST 800-53 / 800-171 control. | NIST CSRC permalink. |
| `MSDocs` | learn.microsoft.com article. | Direct link. |
| `GPO` | Group Policy Object documentation. | learn.microsoft.com permalink. |
| `manifest` | A resource in *another* registered manifest. | Internal manifest link. |
| `user-input` | The user's prompt, used as ground truth. Lowest confidence, flagged. | n/a |

URL deduplication is normalized (lowercase host, fragment stripped,
`utm_*` / `gclid` / `fbclid` / `mc_eid|cid` / `ocid` query params
stripped). Two sources that point at the same article via different
tracking links collapse to one.

## Circular-reference guard

The guard lives in
[`packages/core/src/ai/circular-guard.ts`](https://github.com/Azure/ConfigForge/blob/main/packages/core/src/ai/circular-guard.ts).
We tag every AI-generated comment block with:

```yaml
# <!-- ai-generated:rev=2 -->
```

This **labels** AI output so it can be recognized later. A detection
helper, `assertNotAiGenerated()`, is available in core (with the
spoof-resistant hash registry below) and would reject marked content
if it were fed back in.

> **Honest scope:** today this is a *labeling* feature. The
> `assertNotAiGenerated()` check is **not currently wired** into the
> diff / changelog ingestion path, so re-fed AI output is not
> automatically rejected. Treat provenance and citation coverage as
> heuristic, advisory signals and verify inputs yourself.

### Spoof-resistant content-hash registry (CF-SEC-007)

The inline marker is the primary signal, but an attacker can strip
it before re-feeding content to the system ("strip-and-launder"
attack). v0.2.1 strengthens the guard with a per-process content-hash
registry: whenever we tag a string we also record its hash, so a
re-presented copy without the marker is still recognised.

Implementation notes:

- **NFC-normalised 64-bit FNV-1a hash** - two 32-bit FNV-1a passes
  with different seeds, concatenated. Browser-safe (no Node `crypto`
  dependency), so it doesn't break the renderer Vite bundle.
- **FIFO-bounded at 4,096 entries** - keeps memory finite in
  long-running sessions. The eviction is intentionally lossy: an
  attacker that floods the registry past the cap can evict legitimate
  entries, but the marker-based check remains the primary signal.
- **Process-local** - does not persist across launches.

> **Note:** Marker presence implies AI-generated; marker absence is
> "unknown" (treated as user content). Old manifests without markers
> are not retroactively flagged as user-written or AI-generated.

## "Show your work" toggle

The AI panel has a **Show your work** toggle (off by default). When
on, the panel reveals:

- an input fingerprint;
- the sources the analysis used;
- citation coverage.

## Worked example

You ask the analyzer *"Why does my MaxAuthTries setting differ from
my reference baseline?"*. The analyzer returns:

```text
Your manifest sets MaxAuthTries to 5; the reference baseline expects
it to be ≤ 4. Setting the value to 4 reduces password-spray exposure.

Sources:
  • before (input manifest, confidence 1.00)
  • after (input manifest, confidence 1.00)
Coverage: 100%.
```

If the response had returned with `sources: []` you'd see:

```text
[advisory only, no sources cited]
... explanation ...
[Low confidence. Verify before applying.]
```

## See also

- [User Guide → Diff: Pairwise + CIS + Matrix](./matrix-diff.md)
- [Architecture → Diagrams](../architecture/diagrams.md) (the AI
  provenance flow)
- [API Reference → Diff matrix](../api-reference/diff.md)
