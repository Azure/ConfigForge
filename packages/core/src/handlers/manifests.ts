// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure handlers for the `/api/manifests` route family.
 *
 * Three handlers covering GET (list), POST (register), DELETE.
 * Hosts inject the catalog via Phase 3's `setBaselineCatalog()`.
 *
 * Cache strategy (kept verbatim from the route refactor):
 *   - Two buckets: disk-only (`live=false`) vs. live CLI union
 *     (`live=true`). They never poison each other.
 *   - 60-second TTL — disk reads are cheap, mutations explicitly
 *     invalidate. CLI calls (only on the live path) are slow but
 *     also memoized.
 *   - In-flight dedup via generation counter so concurrent callers
 *     share the same promise.
 *
 * The mutation handler covers content/uri/path resolution, JSON →
 * YAML normalization (manifest JSON, security-definition JSON, raw
 * resource arrays), schema validation, soft platform warnings, and
 * registration save with best-effort history snapshot.
 */
// readFile was removed in v0.2.21 (CF-SEC-017): the legacy `path`
// field that allowed arbitrary host-file reads via a compromised
// renderer is no longer honored. Manifests come from `content`
// (inline YAML) or `uri` (fetched + SSRF-guarded) only.
import yaml from 'js-yaml';
import {
  deleteNamespace,
  deleteRegistration,
  getNamespaces,
  getRegistration,
  getRegistrationSource,
  listRegistrations,
  parseYamlDocument,
  REGISTERED_LINUX_TYPES,
  REGISTERED_WINDOWS_TYPES,
  sanitizeNamespace,
  saveRegistration,
  type ManifestRegistration,
} from '../oscfg';
import {
  detectManifestPlatform,
  extractResourceSummary,
  extractValidationSummary,
  hasMixedPlatformResources,
  type Platform,
  validateManifestSchema,
  walkResourceTypes,
  type ValidationSummary,
} from '../platform';
import { createSnapshot } from '../history';
import { resolveAuthor } from '../history/author';
import { deleteRationale } from '../manifest/rationale-store';
import { deleteAuditResult } from '../manifest/audit-results-store';
import { deleteHistoryForManifest } from '../history';
import { HandlerError } from './errors';

// ─── caching for list ────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000;

let manifestCache: { data: unknown; fetchedAt: number } | null = null;
let liveManifestCache: { data: unknown; fetchedAt: number } | null = null;
let inFlight: { generation: number; live: boolean; promise: Promise<unknown> } | null = null;
let cacheGeneration = 0;

function invalidateCache(): void {
  manifestCache = null;
  liveManifestCache = null;
  cacheGeneration += 1;
  inFlight = null;
}

/** @internal Test affordance — clears all manifest list caches. */
export function _clearManifestsListCache(): void {
  invalidateCache();
}

function platformFromProcess(): Platform {
  return process.platform === 'win32' ? 'windows' : 'linux';
}

// ─── content normalization (shared by POST + import) ────────────────

interface NormalizeResult {
  ok: boolean;
  yaml?: string;
  error?: string;
}

/**
 * Accept YAML, manifest-shaped JSON, or legacy security-definition JSON
 * and return canonical oscfg manifest YAML. Exported so other handlers
 * (notably import) can re-use the same normalization.
 */
export function normalizeManifestContent(content: string): NormalizeResult {
  const trimmed = content.trimStart();
  const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[');
  if (!looksLikeJson) {
    return { ok: true, yaml: content };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    const m = err instanceof Error ? err.message : 'invalid JSON';
    return { ok: false, error: `Content looks like JSON but failed to parse: ${m}` };
  }

  // Raw resource array — wrap in manifest envelope.
  if (Array.isArray(parsed)) {
    return {
      ok: true,
      yaml: yaml.dump(
        { $schema: 'https://aka.ms/osc/schemas/prerelease/document.json', resources: parsed },
        { indent: 2, lineWidth: 120, noRefs: true, sortKeys: false },
      ),
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'JSON manifest must be an object or an array of resources' };
  }

  const obj = parsed as Record<string, unknown>;

  // Canonical manifest JSON.
  if (Array.isArray(obj.resources)) {
    return {
      ok: true,
      yaml: yaml.dump(obj, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: false }),
    };
  }

  // Legacy security-definition JSON.
  const rawSettings =
    (Array.isArray(obj.Settings) && obj.Settings) ||
    (Array.isArray(obj.settings) && obj.settings) ||
    (Array.isArray(obj.desiredConfiguration) && obj.desiredConfiguration) ||
    null;

  if (rawSettings) {
    const resources = (rawSettings as unknown[])
      .map((s) => {
        if (typeof s === 'string') return { name: s, type: 'Microsoft.Windows/Registry', properties: {} };
        if (!s || typeof s !== 'object') return null;
        const sr = s as Record<string, unknown>;
        const name = String(
          sr.Name ?? sr.name ?? sr.settingName ?? sr.SettingName ?? '',
        ).trim();
        if (!name) return null;
        const keyPath = sr.Path ?? sr.path ?? sr.registryPath ?? sr.RegistryPath;
        const expectedValue =
          sr.ExpectedValue ?? sr.expectedValue ?? sr.value ?? sr.Value;
        const type = String(sr.Type ?? sr.type ?? 'Microsoft.Windows/Registry');
        const resource: Record<string, unknown> = {
          name,
          type,
          properties: {
            ...(keyPath ? { keyPath } : {}),
          },
        };
        if (expectedValue !== undefined) {
          resource.compliance = { equals: expectedValue };
        }
        return resource;
      })
      .filter(Boolean);

    if (resources.length === 0) {
      return {
        ok: false,
        error:
          'JSON looks like a security definition but contains no settings. Expected at least one entry in `Settings`/`settings`.',
      };
    }

    return {
      ok: true,
      yaml: yaml.dump(
        { $schema: 'https://aka.ms/osc/schemas/prerelease/document.json', resources },
        { indent: 2, lineWidth: 120, noRefs: true, sortKeys: false },
      ),
    };
  }

  return {
    ok: false,
    error:
      'Unrecognized JSON shape. Expected either an oscfg manifest (with a top-level `resources` array) or a security definition (with a `Settings`/`settings` array).',
  };
}

// ─── GET (list) ─────────────────────────────────────────────────────

interface ListManifestsOptions {
  /** Include namespaces visible in the live CLI (slower). */
  live?: boolean;
  /**
   * Drop per-resource Resources[] arrays from each entry to cut payload.
   *
   * NOTE: default remains `true` (Resources included) for backwards
   * compatibility with existing callers. perf W2 added the `lite` flag
   * below as the explicit opt-in to a Resources-stripped payload — that
   * keeps unrelated callers (e.g. Manifests.tsx, ManifestAuditPack.tsx)
   * working without coordinated touches across agent boundaries.
   * The ManifestEditor.tsx migration to `cfs.manifests.get(name)` makes
   * the only known list caller that actually used Resources moot.
   */
  includeResources?: boolean;
  /**
   * perf W2 (H6, conservative variant): explicit opt-in to drop
   * Resources[] from each entry, regardless of `includeResources`.
   * Equivalent to passing `includeResources: false`, but added as a
   * separate flag so callers (e.g. Home.tsx, dashboard counts) can
   * declare intent without colliding with the legacy `includeResources`
   * default. Prefer this over toggling the default — flipping the
   * default is reserved for a coordinated migration once every list
   * caller has been audited.
   */
  lite?: boolean;
}

async function readSourceYaml(namespace: string): Promise<string | null> {
  try {
    return await getRegistrationSource(namespace);
  } catch {
    return null;
  }
}

async function readCliNamespaces(): Promise<string[]> {
  const ns = await getNamespaces();
  if (!ns.success || !ns.data) return [];
  return ns.data
    .map((n) => (typeof n === 'string' ? n : String((n as { name?: string }).name ?? '')))
    .filter(Boolean);
}

async function buildManifestList(
  includeLive: boolean,
  includeResources: boolean,
): Promise<unknown[]> {
  const [regs, cliNamespaces] = await Promise.all([
    listRegistrations(),
    includeLive ? readCliNamespaces() : Promise.resolve<string[]>([]),
  ]);

  const regByNs = new Map<string, ManifestRegistration>(regs.map((r) => [r.namespace, r]));
  const cliSet = new Set(cliNamespaces);
  const allNames = new Set<string>([...Array.from(regByNs.keys()), ...cliNamespaces]);

  return Promise.all(
    Array.from(allNames).map(async (name) => {
      const reg = regByNs.get(name);
      const cliVisible = cliSet.has(name);
      const deployed = Boolean(reg?.lastAppliedAt) || cliVisible;

      if (reg) {
        let summary = reg.resourceSummary;
        let validation: ValidationSummary | undefined = reg.validationSummary;
        if (!summary || !validation) {
          try {
            const sourceYaml = await readSourceYaml(name);
            if (sourceYaml) {
              const doc = parseYamlDocument(sourceYaml) as Record<string, unknown>;
              const resources = Array.isArray(doc?.resources) ? doc.resources : [];
              if (!summary) summary = extractResourceSummary(resources);
              if (!validation) validation = extractValidationSummary(doc);
            }
          } catch {
            summary = summary ?? [];
            validation = validation ?? {
              hasSchema: false,
              hasEnforcementValues: false,
              hasComplianceCriteria: false,
              issues: ['Could not read or parse the registered source for validation'],
            };
          }
        }
        const resources = (summary ?? []).map((r) => ({ name: r.name, type: r.type }));
        const base = {
          Name: name,
          DisplayName: reg.displayName ?? name,
          Source: reg.source === 'library' ? 'library' : 'oscfg',
          Deployed: deployed,
          LastAppliedAt: reg.lastAppliedAt ?? null,
          LastAuditedAt: reg.lastAuditedAt ?? null,
          Platform: reg.platform ?? null,
          ResourceCount: resources.length,
          Validation: validation ?? null,
        };
        return includeResources ? { ...base, Resources: resources } : base;
      }

      const cliBase = {
        Name: name,
        DisplayName: name,
        Source: 'oscfg' as const,
        Deployed: true,
        LastAppliedAt: null,
        LastAuditedAt: null,
        ResourceCount: 0,
        Validation: null,
      };
      return includeResources ? { ...cliBase, Resources: [] as { name: string; type: string }[] } : cliBase;
    }),
  );
}

export async function listManifests(opts: ListManifestsOptions = {}): Promise<{ data: unknown[] }> {
  const live = opts.live === true;
  // `lite: true` always strips Resources, regardless of includeResources.
  // Otherwise the legacy default (Resources included) holds.
  const includeResources = opts.lite === true ? false : opts.includeResources !== false;

  const bucket = live ? liveManifestCache : manifestCache;
  let baseData: unknown[];
  if (bucket && Date.now() - bucket.fetchedAt < CACHE_TTL_MS) {
    baseData = bucket.data as unknown[];
  } else {
    if (!inFlight || inFlight.live !== live) {
      const generation = cacheGeneration;
      const promise = (async () => {
        // Always build the FULL list so include=full and include=summary
        // share a single in-memory cache; we strip Resources at response time.
        const data = await buildManifestList(live, /* includeResources */ true);
        if (cacheGeneration === generation) {
          if (live) liveManifestCache = { data, fetchedAt: Date.now() };
          else manifestCache = { data, fetchedAt: Date.now() };
        }
        return data;
      })().finally(() => {
        if (inFlight && inFlight.generation === generation && inFlight.live === live) {
          inFlight = null;
        }
      });
      inFlight = { generation, live, promise };
    }
    baseData = (await inFlight.promise) as unknown[];
  }

  if (!includeResources) {
    return {
      data: baseData.map((entry) => {
        if (entry && typeof entry === 'object' && 'Resources' in entry) {
          const { Resources: _r, ...rest } = entry as Record<string, unknown>;
          void _r;
          return rest;
        }
        return entry;
      }),
    };
  }
  return { data: baseData };
}

// ─── GET (single) ───────────────────────────────────────────────────

export interface GetManifestOptions {
  /** Include the full Resources[] in the returned manifest. Default true. */
  includeResources?: boolean;
}

export interface GetManifestResult {
  data: {
    Name: string;
    DisplayName: string;
    Source: 'library' | 'oscfg';
    Deployed: boolean;
    LastAppliedAt: string | null;
    LastAuditedAt: string | null;
    Platform: string | null;
    ResourceCount: number;
    Validation: ValidationSummary | null;
    Resources?: { name: string; type: string }[];
  } | null;
  warning?: string;
}

/**
 * Read a single manifest by namespace.
 *
 * perf W2 / C5: ManifestEditor previously fetched the full list and
 * threw away N-1 entries; this lets the renderer fetch just the one
 * it cares about. Includes Resources[] by default (the editor needs
 * them); pass `{ includeResources: false }` to skip.
 *
 * Mirrors the shape produced by `buildManifestList()` for the
 * `regByNs.get(name)` branch so the renderer can swap in the new
 * channel without reshaping its `OscManifest` consumer code. Returns
 * `data: null` (NOT throw) when the namespace is unknown — same
 * convention as `getManifestStatus()`.
 */
export async function getManifest(
  name: string,
  opts: GetManifestOptions = {},
): Promise<GetManifestResult> {
  if (!name || typeof name !== 'string') {
    throw new HandlerError(400, 'name is required');
  }
  const includeResources = opts.includeResources !== false;
  const namespace = sanitizeNamespace(name);

  const regs = await listRegistrations();
  const reg = regs.find((r) => r.namespace === namespace);
  if (!reg) {
    return { data: null };
  }

  let summary = reg.resourceSummary;
  let validation: ValidationSummary | undefined = reg.validationSummary;
  let warning: string | undefined;
  if (!summary || !validation) {
    try {
      const sourceYaml = await readSourceYaml(namespace);
      if (sourceYaml) {
        const doc = parseYamlDocument(sourceYaml) as Record<string, unknown>;
        const resources = Array.isArray(doc?.resources) ? doc.resources : [];
        if (!summary) summary = extractResourceSummary(resources);
        if (!validation) validation = extractValidationSummary(doc);
      } else {
        warning = 'Registered source YAML missing on disk';
      }
    } catch (err) {
      warning = err instanceof Error ? err.message : 'Failed to parse source YAML';
      summary = summary ?? [];
      validation = validation ?? {
        hasSchema: false,
        hasEnforcementValues: false,
        hasComplianceCriteria: false,
        issues: ['Could not read or parse the registered source for validation'],
      };
    }
  }

  const resources = (summary ?? []).map((r) => ({ name: r.name, type: r.type }));
  const data = {
    Name: namespace,
    DisplayName: reg.displayName ?? namespace,
    Source: (reg.source === 'library' ? 'library' : 'oscfg') as 'library' | 'oscfg',
    Deployed: Boolean(reg.lastAppliedAt),
    LastAppliedAt: reg.lastAppliedAt ?? null,
    LastAuditedAt: reg.lastAuditedAt ?? null,
    Platform: reg.platform ?? null,
    ResourceCount: resources.length,
    Validation: validation ?? null,
    ...(includeResources ? { Resources: resources } : {}),
  };

  return warning ? { data, warning } : { data };
}

// ─── POST (register) ─────────────────────────────────────────────────

const MAX_REMOTE_BYTES = 10 * 1024 * 1024;

/**
 * Fetch a remote manifest's text content over HTTP/HTTPS.
 *
 * Extracted from `registerManifest()` in v0.2.15 so the renderer can
 * call it directly to preview/edit a manifest from a URL *before*
 * committing to register it with the CLI. The shape (timeout, byte cap,
 * scheme guard, error mapping) is identical to the in-line version that
 * `registerManifest` used to inline, so register-via-uri behavior is
 * unchanged.
 */
export async function fetchManifestFromUri(uri: string): Promise<string> {
  if (typeof uri !== 'string' || !uri.trim()) {
    throw new HandlerError(400, 'uri is required');
  }
  let parsedUri: URL;
  try {
    parsedUri = new URL(uri);
  } catch {
    throw new HandlerError(400, 'Invalid URI: must be a fully-qualified URL');
  }
  if (parsedUri.protocol !== 'http:' && parsedUri.protocol !== 'https:') {
    throw new HandlerError(
      400,
      `Unsupported URI scheme '${parsedUri.protocol}': only http and https are allowed`,
    );
  }

  // v0.2.21 (CF-SEC-016): SSRF guard. Block private / loopback /
  // link-local IPs before any network call. Without this, a user (or
  // a compromised renderer dispatching `cfs:manifests:fetch-uri`)
  // could direct the privileged main process to fetch cloud metadata
  // (Azure/AWS IMDS at 169.254.169.254), internal-network admin
  // panels, or the local Node DevTools port. The fetched body is
  // returned to the renderer as "manifest content," exfiltrating
  // arbitrary internal-network responses.
  //
  // Hostname-only blocks: a hostname that resolves to a private IP
  // via DNS is NOT caught here. A future hardening pass should add a
  // resolve-and-recheck step before fetch (`dns.lookup` then walk the
  // result through the same predicates). For now this guard catches
  // the direct-IP attack vectors which are the practical SSRF risk
  // for the URL-import feature.
  const host = parsedUri.hostname.replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^0\.0\.0\.0$/.test(host) ||
    host === '::1' ||
    /^fc[0-9a-f]{2}:/i.test(host) ||
    /^fd[0-9a-f]{2}:/i.test(host) ||
    /^fe80:/i.test(host)
  ) {
    throw new HandlerError(
      400,
      `URI resolves to a private/loopback address (${host}). Manifest URLs must point to a public host.`,
    );
  }

  try {
    const res = await fetch(uri, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cl = res.headers.get('content-length');
    if (cl && Number(cl) > MAX_REMOTE_BYTES) {
      throw new HandlerError(
        413,
        `Remote manifest too large (${cl} bytes); limit is 10 MB.`,
      );
    }
    const text = await res.text();
    if (text.length > MAX_REMOTE_BYTES) {
      throw new HandlerError(
        413,
        `Remote manifest too large (${text.length} bytes); limit is 10 MB.`,
      );
    }
    return text;
  } catch (err) {
    if (err instanceof HandlerError) throw err;
    const m = err instanceof Error ? err.message : 'fetch failed';
    throw new HandlerError(400, `Failed to fetch manifest from URI: ${m}`);
  }
}

export interface RegisterManifestRequest {
  name: string;
  /** One of `path`, `uri`, or `content` is required. */
  path?: string;
  uri?: string;
  content?: string;
  source?: 'user' | 'library' | 'import';
  sourceId?: string;
  /** Optional change rationale, persisted in the history sidecar. */
  rationale?: string;
  /** Optional explicit author override (server resolves if absent). */
  author?: string;
  /**
   * Optional short human-readable summary of what changed in this
   * revision (e.g. "AuditAccountLockout modified"). When present, used
   * as the History snapshot message instead of the generic
   * "Manifest registered" — surfaces what changed in the version list
   * without making the user open the rationale modal. Computed
   * client-side from the YAML diff; capped to a short length by the
   * IPC validator.
   */
  changeSummary?: string;
  /**
   * v0.3.0 (#20): explicit overwrite acknowledgement. When the
   * sanitized namespace collides with an existing registration that
   * has a different displayName, the handler surfaces a warning by
   * default. Set `force: true` to skip the warning and overwrite
   * silently — used by callers that already showed the user a
   * confirmation prompt.
   */
  force?: boolean;
}

export interface RegisterManifestResult {
  message: string;
  data: { namespace: string; platform: Platform | 'mixed' | 'cross-platform' | 'unknown' };
  warnings: string[];
}

export async function registerManifest(
  req: RegisterManifestRequest,
): Promise<RegisterManifestResult> {
  if (!req || typeof req.name !== 'string' || !req.name) {
    throw new HandlerError(400, 'name is required');
  }
  const namespace = sanitizeNamespace(req.name);
  if (!namespace) {
    throw new HandlerError(400, 'name must contain at least one alphanumeric character');
  }

  // Resolve content per priority: content > uri > path.
  let yamlContent: string | null = req.content ?? null;

  if (!yamlContent && req.uri) {
    yamlContent = await fetchManifestFromUri(req.uri);
  }

  // v0.2.21 (CF-SEC-017): the legacy `path` field — a Next.js-era
  // server-side hook for reading from the host filesystem — is
  // intentionally NOT honored here. Letting a compromised renderer
  // pass `{path: "C:\\Users\\<victim>\\.ssh\\id_rsa"}` would turn
  // register into an arbitrary-file-read primitive. The renderer
  // has no legitimate use for this path (file imports go through
  // the importChannel IPC, content imports go through `content`,
  // and URL imports go through `uri`). Reject explicitly so an
  // attempted exfil shows up in logs.
  if (req.path) {
    throw new HandlerError(
      400,
      'The "path" field is no longer supported. Pass YAML via "content" or a URL via "uri" instead.',
    );
  }

  // Treat empty/whitespace-only as absent.
  if (typeof yamlContent === 'string' && !yamlContent.trim()) {
    yamlContent = null;
  }
  if (!yamlContent) {
    throw new HandlerError(400, 'One of path, uri, or content is required');
  }

  const normalized = normalizeManifestContent(yamlContent);
  if (!normalized.ok || !normalized.yaml) {
    throw new HandlerError(400, normalized.error ?? 'normalize failed');
  }
  yamlContent = normalized.yaml;

  // Hard schema validation.
  const parsed = parseYamlDocument(yamlContent) as { resources?: unknown[] };
  const schemaErrors = validateManifestSchema(parsed);
  if (schemaErrors.length) {
    throw new HandlerError(400, `Invalid manifest schema:\n${schemaErrors.join('\n')}`);
  }

  // Soft platform warnings.
  const resources = parsed.resources ?? [];
  const manifestPlatform = detectManifestPlatform(resources);
  const host = platformFromProcess();
  const warnings: string[] = [];

  // v0.3.0 (#20): namespace-collision warning. Two different display
  // names that sanitize to the same namespace will silently clobber
  // each other; we now surface that as a soft warning the UI shows
  // in a banner. The renderer (or a future CLI) can pass
  // `req.force = true` to skip the warning and overwrite explicitly.
  if (!req.force) {
    const existing = await getRegistration(namespace);
    if (existing && existing.displayName && existing.displayName !== req.name) {
      warnings.push(
        `Manifest name "${req.name}" maps to the same namespace ("${namespace}") as the existing "${existing.displayName}". Registering will overwrite the existing manifest's source YAML, deploy history pointer, and rationale log. Use a different name (or pass force:true) to keep both manifests.`,
      );
    }
  }

  if (manifestPlatform === 'mixed' || hasMixedPlatformResources(resources)) {
    warnings.push(
      'Manifest mixes Windows and Linux resource types. You can register it, but audit/deploy will be blocked until the resource types are split into per-platform manifests.',
    );
  } else if (
    (manifestPlatform === 'windows' && host !== 'windows') ||
    (manifestPlatform === 'linux' && host !== 'linux')
  ) {
    warnings.push(
      `Manifest targets ${manifestPlatform}, but this host is ${host}. Registration OK — deploy or audit on a ${manifestPlatform} target to apply it.`,
    );
  }

  if (manifestPlatform === host || manifestPlatform === 'cross-platform') {
    const registered = new Set<string>(
      host === 'windows' ? REGISTERED_WINDOWS_TYPES : REGISTERED_LINUX_TYPES,
    );
    const unregistered = new Set<string>();
    for (const { type } of walkResourceTypes(resources)) {
      if (!registered.has(type)) unregistered.add(type);
    }
    if (unregistered.size > 0) {
      warnings.push(
        `Resource types not yet registered in the bundled oscfg CLI on this host: ${Array.from(unregistered).join(', ')}. Deploy may fail until the CLI is upgraded.`,
      );
    }
  }

  await saveRegistration(
    {
      namespace,
      displayName: req.name,
      platform: manifestPlatform,
      registeredAt: new Date().toISOString(),
      source: req.source ?? 'user',
      sourceId: req.sourceId,
      resourceSummary: extractResourceSummary(resources),
      validationSummary: extractValidationSummary(parsed as Record<string, unknown>),
    },
    yamlContent,
  );

  invalidateCache();

  // Best-effort auto-snapshot. NOT awaited — must not delay or fail the
  // registration response.
  //
  // PR (v0.3.47): when the renderer provides a `changeSummary` (computed
  // from the client-side YAML diff, e.g. "AccountLockoutThreshold
  // modified"), use it as the History snapshot message so the version
  // list shows what changed instead of always saying "Manifest
  // registered". Falls back to the generic label for first-time
  // registration and for callers that don't compute a summary.
  const summary = typeof req.changeSummary === 'string' ? req.changeSummary.trim() : '';
  const snapshotMessage = summary || 'Manifest registered';
  const author = req.author;
  const rationale = req.rationale;
  const yamlForSnapshot = yamlContent;
  Promise.resolve()
    .then(async () => {
      let resolvedAuthor: string | undefined;
      let resolvedEmail: string | undefined;
      if (author && author.trim()) {
        resolvedAuthor = author;
      } else {
        try {
          const r = await resolveAuthor();
          resolvedAuthor = r.name;
          resolvedEmail = r.email;
        } catch {
          resolvedAuthor = undefined;
        }
      }
      await createSnapshot(namespace, yamlForSnapshot, {
        message: snapshotMessage,
        ...(resolvedAuthor !== undefined ? { author: resolvedAuthor } : {}),
        ...(resolvedEmail !== undefined ? { authorEmail: resolvedEmail } : {}),
        ...(typeof rationale === 'string' && rationale ? { rationale } : {}),
      });
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.warn(
        `[history] auto-snapshot failed for '${namespace}': ${err instanceof Error ? err.message : err}`,
      );
    });

  return {
    message: `Manifest '${req.name}' registered`,
    data: { namespace, platform: manifestPlatform },
    warnings,
  };
}

// ─── DELETE ─────────────────────────────────────────────────────────

export interface DeleteManifestResult {
  message: string;
  data: {
    namespace: string;
    cliRemoved: boolean;
    cliError: string | null;
    rationaleLogRemoved: boolean;
    rationaleLogError: string | null;
  };
}

export async function deleteManifest(name: string): Promise<DeleteManifestResult> {
  if (!name) throw new HandlerError(400, 'name query parameter is required');
  const namespace = sanitizeNamespace(name);

  // Best-effort CLI cleanup. Registered-but-never-deployed manifests
  // won't exist in the CLI; that's expected, not an error. Always
  // delete the ConfigForge-side registration afterwards so the UI
  // doesn't leak stale entries.
  const cli = await deleteNamespace(namespace);
  await deleteRegistration(namespace);

  // Drop the per-manifest rationale log. Best-effort — a cleanup
  // failure must not block the manifest delete.
  let rationaleLogRemoved = false;
  let rationaleLogError: string | null = null;
  try {
    const rationale = await deleteRationale(namespace);
    rationaleLogRemoved = rationale.removed;
    rationaleLogError = rationale.removed ? null : rationale.error ?? null;
  } catch (err) {
    rationaleLogError = err instanceof Error ? err.message : String(err);
  }

  // v0.1.6: drop the cached last-audit-run JSON too. Best-effort,
  // same reasoning as the rationale-log cleanup above. Doesn't
  // surface in the response shape because the audit-result cache is
  // an implementation detail callers shouldn't depend on.
  await deleteAuditResult(namespace).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn(`[manifests] audit-result cleanup failed for ${namespace}:`, err);
  });

  // v0.2.21: drop the manifest's history directory. Without this,
  // a re-registration under the same namespace surfaces ghost
  // snapshots from the prior manifest on the History page, and a
  // user clicking "Restore snapshot" would silently overwrite their
  // new YAML with old, unrelated content.
  await deleteHistoryForManifest(namespace).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn(`[manifests] history cleanup failed for ${namespace}:`, err);
  });

  invalidateCache();

  return {
    message: `Manifest '${name}' removed`,
    data: {
      namespace,
      cliRemoved: cli.success,
      cliError: cli.success ? null : cli.error,
      rationaleLogRemoved,
      rationaleLogError,
    },
  };
}
