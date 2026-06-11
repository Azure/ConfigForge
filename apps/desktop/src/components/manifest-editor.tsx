// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import type { OnChange, Monaco } from "@monaco-editor/react";
import yaml from "js-yaml";
import oscSchema from "../data/osc-manifest-schema.json";
import {
  WarningRegular,
  ChevronDownRegular,
  ChevronUpRegular,
  ChevronRightRegular,
  DismissCircleRegular,
  InfoRegular,
  SpinnerIosRegular,
  ShieldCheckmarkRegular,
  CheckmarkCircleRegular,
  DismissRegular as CloseIcon,
  SearchRegular,
  ListRegular,
  HistoryRegular,
} from "@fluentui/react-icons";
import { type Platform, getValidTypesForPlatform, getPlatformForType, CROSS_PLATFORM_TYPES } from "@configforge/core/platform";
import { isRegisteredType } from "@configforge/core/oscfg/registered-types";
import { RecentRationaleSidebar } from "./recent-rationale-sidebar";
import { EditorBottomDrawer, type DrawerTab } from "./editor-bottom-drawer";
import { cfs } from "../lib/cfs";
import { useNumberFormatter } from "../lib/format";

type DocShape = 'manifest' | 'legacy-security-definition' | 'unknown';

function detectDocShape(doc: Record<string, unknown>): DocShape {
  if (Array.isArray(doc.resources)) return 'manifest';
  if (doc.Settings || doc.settings || doc.desiredConfiguration) return 'legacy-security-definition';
  return 'unknown';
}

type Severity = 'error' | 'warning' | 'info';

interface ValidationMessage {
  text: string;
  severity: Severity;
}

const MonacoEditor = lazy(async () => {
  const [{ default: Editor }] = await Promise.all([
    import('@monaco-editor/react'),
    import('../lib/monaco-setup').then((m) => m.setupMonaco()),
  ]);
  return { default: Editor };
});

/**
 * Render-only wrapper around `<MonacoEditor>` that supplies the
 * loading fallback we used to pass to `next/dynamic`. Vite splits the
 * Monaco bundle automatically via React.lazy.
 */
function Editor(props: React.ComponentProps<typeof MonacoEditor>) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-400">
          <SpinnerIosRegular className="h-4 w-4 animate-spin" />
          Loading editor…
        </div>
      }
    >
      <MonacoEditor {...props} />
    </Suspense>
  );
}

const PLACEHOLDER = `$schema: https://aka.ms/osc/schemas/prerelease/document.json
resources:
  - name: "Setting name"
    type: Microsoft.Windows/Registry
    properties:
      keyPath: "HKLM:\\\\SOFTWARE\\\\..."
      valueName: "ValueName"
      valueType: Dword
    compliance:
      equals: 0
`;

interface ConfigEditorProps {
  value?: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  language?: 'yaml' | 'json' | 'plaintext';
  height?: string;
  platform?: Platform;
  /**
   * PR24: when true, show a CIS cross-reference sidebar that looks up
   * the resource at the editor cursor against the bundled CIS rule
   * catalog. Off by default so existing call-sites are unaffected.
   */
  showCisCrossref?: boolean;
  /**
   * PR27: when set, the editor renders a "Recent rationale" panel for
   * the resource currently under the cursor. The panel piggy-backs on
   * the same right-side sidebar as the CIS cross-reference. Pass the
   * manifest namespace (sanitized) — the panel uses it to call
   * `/api/manifests/<id>/rationale`.
   */
  manifestId?: string;
  /** When true, show a Resource Explorer left sidebar with resources grouped by type. */
  showResourceExplorer?: boolean;
}

interface CisLookupResult {
  ruleId: string;
  /** Legacy JSON: CIS rule name. XCCDF/Azure Policy: rule title. */
  name?: string;
  title?: string;
  severity: string;
  gpoPath?: string | null;
  osVersion?: string;
  /** Description (Azure Policy: value info; XCCDF: full description). */
  description?: string;
  /** Where the match came from. */
  source?: 'json' | 'xccdf' | 'azure-policy';
  /** Benchmark name (XCCDF/Azure Policy). */
  benchmark?: string;
  /** XCCDF fixtext (GPO path + remediation). */
  fixtext?: string;
  /** PR26: 1.0 for verbatim name match, 0.7 for property-mapping fallback. */
  confidence?: number | string;
  /** PR26: 'strict' for verbatim name match, 'property-mapping' for fallback. */
  matchSource?: 'strict' | 'property-mapping';
}

interface CisActiveContext {
  name: string;
  type: string | null;
  propertyName: string | null;
  propertySubcategory: string | null;
}

export function ConfigEditor({
  value,
  onChange,
  readOnly = false,
  language = 'yaml',
  height = '100%',
  platform,
  showCisCrossref = false,
  manifestId,
  showResourceExplorer = false,
}: ConfigEditorProps) {
  const [validationMessages, setValidationMessages] = useState<ValidationMessage[]>([]);
  const [unregisteredTypes, setUnregisteredTypes] = useState<string[]>([]);
  const [panelExpanded, setPanelExpanded] = useState(false);
  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<unknown>(null);
  // Diff-dropdown-freeze fix: Monaco's overflow widgets (find/replace, suggest,
  // hover, parameter hints) default to `document.body` when `fixedOverflowWidgets`
  // is on, where a dispose/unmount race during rapid navigation could orphan a
  // position:fixed overlay that sat invisibly over the Diff "Select manifest"
  // <select>, swallowed clicks, and froze the dropdown until app restart. We host
  // them in a node WE own and remove on unmount, so no orphan can survive.
  //
  // The host is created with `document.createElement` (NOT rendered as JSX) on
  // purpose: React tags every node it renders with `__reactFiber$…` / `__reactProps$…`
  // expando properties that point into the cyclic Fiber tree. Monaco deep-clones
  // the editor options — which include `overflowWidgetsDomNode` — and cloning a
  // React-owned node walks those expandos and recurses through the whole Fiber
  // graph forever ("Maximum call stack size exceeded"), crashing the renderer on a
  // later editor mount. A plain detached div has no such expandos and is safe.
  const overflowHostRef = useRef<HTMLDivElement | null>(null);
  if (overflowHostRef.current === null && typeof document !== "undefined") {
    const host = document.createElement("div");
    host.className = "monaco-overflow-host";
    overflowHostRef.current = host;
  }
  const lastDocShapeRef = useRef<DocShape>('unknown');
  // PR24/26: CIS cross-reference sidebar state
  const [cisActiveCtx, setCisActiveCtx] = useState<CisActiveContext | null>(null);
  const [cisLookup, setCisLookup] = useState<CisLookupResult | null>(null);
  const [cisLoading, setCisLoading] = useState(false);
  const [cisDismissed, setCisDismissed] = useState(false);
  const cisLookupCacheRef = useRef<Map<string, CisLookupResult | null>>(new Map());
  const cisActiveName = cisActiveCtx?.name ?? null;

  // Attach the React-free overflow host to <body> for the editor's lifetime and
  // remove it on unmount. Monaco's fixed overflow widgets are appended into this
  // node; tearing it down with the component is what prevents the orphaned
  // click-swallowing overlay that froze the Diff dropdown. useLayoutEffect so the
  // host is in the DOM before the lazily-mounted editor first lays out a widget.
  useLayoutEffect(() => {
    const host = overflowHostRef.current;
    if (!host || typeof document === "undefined") return;
    document.body.appendChild(host);
    return () => {
      host.remove();
    };
  }, []);

  const validateContent = useCallback((content: string, lang: string) => {
    const messages: ValidationMessage[] = [];
    const sev = (text: string, severity: Severity = 'error'): ValidationMessage =>
      ({ text, severity: readOnly && severity === 'error' ? 'warning' : severity });

    // --- Step 1: parse ---
    let doc: Record<string, unknown> | null = null;
    try {
      // Try YAML first (superset of JSON), then JSON as fallback
      const parsed = yaml.load(content);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        doc = parsed as Record<string, unknown>;
      } else {
        try {
          const jsonParsed = JSON.parse(content);
          if (jsonParsed && typeof jsonParsed === 'object' && !Array.isArray(jsonParsed)) {
            doc = jsonParsed as Record<string, unknown>;
          }
        } catch { /* fall through */ }
        if (!doc) {
          messages.push(sev('Document must be a YAML/JSON object'));
        }
      }
    } catch (yamlErr) {
      // YAML parse failed — try JSON directly. If JSON also fails, surface
      // the error from the user's *primary* language. Don't wrap a JSON
      // parser error in a "YAML syntax error:" prefix — that produces
      // "YAML syntax error: ... is not valid JSON" which is contradictory.
      try {
        const jsonParsed = JSON.parse(content);
        if (jsonParsed && typeof jsonParsed === 'object' && !Array.isArray(jsonParsed)) {
          doc = jsonParsed as Record<string, unknown>;
        } else {
          messages.push(sev('Document must be a YAML/JSON object'));
        }
      } catch (jsonErr) {
        const isJson = lang === 'json';
        const syntaxType = isJson ? 'JSON' : 'YAML';
        const err = isJson ? jsonErr : yamlErr;
        const msg = err instanceof Error ? err.message : String(err);
        messages.push(sev(`${syntaxType} syntax error: ${msg}`));
      }
    }

    // --- Step 2: detect content shape ---
    const shape: DocShape = doc ? detectDocShape(doc) : 'unknown';
    lastDocShapeRef.current = shape;

    if (doc && shape === 'legacy-security-definition') {
      messages.push({
        text: 'Legacy security-definition format detected. Use the converter to migrate to manifest format.',
        severity: 'info',
      });
      setValidationMessages(messages);
      setUnregisteredTypes([]);
      updateMonacoSchema(shape);
      return;
    }

    if (doc && shape === 'unknown') {
      messages.push({ text: 'Unrecognized document format', severity: 'warning' });
      setValidationMessages(messages);
      setUnregisteredTypes([]);
      updateMonacoSchema(shape);
      return;
    }

    // --- Step 3: manifest validation (shape === 'manifest') ---
    if (doc) {
      const VALID_RESOURCE_TYPES = platform
        ? getValidTypesForPlatform(platform)
        : [...CROSS_PLATFORM_TYPES, ...getValidTypesForPlatform('windows'), ...getValidTypesForPlatform('linux')];

      const schema = doc.$schema as string | undefined;
      if (schema && !schema.includes('document.json') && !schema.includes('manifest.json')) {
        messages.push(sev('Unrecognized $schema URL. Expected "https://aka.ms/osc/schemas/prerelease/document.json"'));
      }

      if (!Array.isArray(doc.resources)) {
        messages.push(sev('"resources" must be an array'));
      } else {
        (doc.resources as Record<string, unknown>[]).forEach((r, i) => {
          const label = r.name ? `"${r.name}"` : `#${i + 1}`;
          if (!r.name) messages.push(sev(`Resource ${label}: missing "name" field`));
          if (!r.type) {
            messages.push(sev(`Resource ${label}: missing "type" field`));
          } else if (!VALID_RESOURCE_TYPES.includes(r.type as string)) {
            const typePlatform = getPlatformForType(r.type as string);
            if (platform && typePlatform !== 'cross-platform' && typePlatform !== platform) {
              const wrongPlatform = platform === 'windows' ? 'Linux' : 'Windows';
              messages.push(sev(`Resource ${label}: "${r.type}" is a ${wrongPlatform}-only resource and cannot be used in a ${platform} manifest`));
            } else {
              messages.push(sev(`Resource ${label}: invalid type "${r.type}". Must be one of: ${VALID_RESOURCE_TYPES.join(', ')}`));
            }
          }
          if (!r.properties || typeof r.properties !== 'object') {
            messages.push(sev(`Resource ${label}: missing or invalid "properties" object`));
          } else {
            const props = r.properties as Record<string, unknown>;
            const rtype = r.type as string;
            if (rtype === 'Microsoft.Windows/Registry') {
              if (!props.keyPath) messages.push(sev(`Resource ${label}: Registry resource requires "keyPath" in properties`));
              if (!props.valueName) messages.push(sev(`Resource ${label}: Registry resource requires "valueName" in properties`));
              if (!props.valueType) messages.push(sev(`Resource ${label}: Registry resource requires "valueType" in properties`));
            } else if (rtype === 'Microsoft.Windows/CSP') {
              if (!props.path) messages.push(sev(`Resource ${label}: CSP resource requires "path" in properties`));
              if (!props.type) messages.push(sev(`Resource ${label}: CSP resource requires "type" in properties`));
            } else if (rtype === 'Microsoft.Windows/AccountPolicy') {
              if (!props.name) messages.push(sev(`Resource ${label}: AccountPolicy resource requires "name" in properties`));
            } else if (rtype === 'Microsoft.Windows/AuditPolicy') {
              if (!props.subcategory) messages.push(sev(`Resource ${label}: AuditPolicy resource requires "subcategory" in properties`));
            } else if (rtype === 'Microsoft.Windows/UserRightsAssignment') {
              if (!props.name) messages.push(sev(`Resource ${label}: UserRightsAssignment resource requires "name" in properties`));
            } else if (rtype === 'Microsoft.OSConfig/Test') {
              if (!props.resource) messages.push(sev(`Resource ${label}: Test resource requires "resource" in properties`));
              if (platform && props.resource && typeof props.resource === 'object') {
                const nestedType = (props.resource as Record<string, unknown>).type as string | undefined;
                if (nestedType) {
                  const nestedPlatform = getPlatformForType(nestedType);
                  if (nestedPlatform !== 'cross-platform' && nestedPlatform !== platform) {
                    const wrongPlatform = platform === 'windows' ? 'Linux' : 'Windows';
                    messages.push(sev(`Resource ${label}: wraps "${nestedType}" which is a ${wrongPlatform}-only resource and cannot be used in a ${platform} manifest`));
                  }
                }
              }
            } else if (rtype === 'Microsoft.OSConfig/Firmware' || rtype === 'Microsoft.OSConfig/DeviceInfo') {
              if (Object.keys(props).length === 0) {
                messages.push(sev(`Resource ${label}: ${rtype} is a read-only resource with no properties; it will cause errors when deployed`));
              }
            } else if (rtype === 'Linux/FilePermission') {
              if (!props.path) messages.push(sev(`Resource ${label}: FilePermission resource requires "path" in properties`));
            } else if (rtype === 'Linux/KernelModule') {
              if (!props.name) messages.push(sev(`Resource ${label}: KernelModule resource requires "name" in properties`));
            } else if (rtype === 'Linux/User') {
              if (!props.name) messages.push(sev(`Resource ${label}: User resource requires "name" in properties`));
            } else if (rtype === 'Microsoft.OSConfig/File') {
              if (!props.path) messages.push(sev(`Resource ${label}: File resource requires "path" in properties`));
            } else if (rtype === 'Microsoft.OSConfig/FileLine') {
              if (!props.path) messages.push(sev(`Resource ${label}: FileLine resource requires "path" in properties`));
            }
          }
        });
      }
    }

    setValidationMessages(messages);

    // Soft pre-check: flag resource types not registered in bundled CLI
    const unregistered = new Set<string>();
    if (doc && Array.isArray(doc.resources) && platform) {
      const plat = platform === 'windows' ? 'win32' : 'linux';
      for (const r of doc.resources as Record<string, unknown>[]) {
        const t = r?.type;
        if (typeof t === 'string' && t && !isRegisteredType(t, plat)) {
          unregistered.add(t);
        }
      }
    }
    setUnregisteredTypes(Array.from(unregistered));

    updateMonacoSchema(shape);

    if (messages.some(m => m.text.includes('only resource and cannot be used'))) {
      setPanelExpanded(true);
    }
  }, [platform, readOnly]);

  // Conditionally apply Monaco JSON schema only for manifest content
  const updateMonacoSchema = useCallback((shape: DocShape) => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      // Keep the schema attached for IntelliSense / autocomplete on
      // property names, but DON'T emit schema-violation diagnostics:
      // the bundled `osc-manifest-schema.json` is intentionally narrow
      // (5 resource types, additionalProperties:false in several
      // places) and produces noisy yellow squiggles on the full
      // Microsoft OSConfig manifest catalog (Microsoft.OSConfig/Test,
      // Microsoft.Windows/SecurityPolicy, etc.) which the schema
      // doesn't enumerate. Our own validateContent() does the real
      // shape + platform + registered-types checks. Monaco's built-in
      // JSON syntax errors (unclosed strings, parse errors) and
      // trailingCommas/comments severities below are unaffected by
      // this option — those still surface in the editor.
      schemaValidation: 'ignore',
      schemas: shape === 'manifest'
        ? [{
            uri: 'https://aka.ms/osc/schemas/prerelease/document.json',
            fileMatch: ['*'],
            schema: oscSchema as Record<string, unknown>,
          }]
        : [],
    });
  }, []);

  const handleChange: OnChange = (newValue) => {
    if (newValue !== undefined) {
      onChange?.(newValue);
      if (language === 'yaml' || language === 'json') {
        validateContent(newValue, language);
      }
    }
  };

  const handleEditorMount = (editor: unknown, monaco: Monaco) => {
    monacoRef.current = monaco;
    editorRef.current = editor;
    // Apply schema conditionally based on last detected content shape
    updateMonacoSchema(lastDocShapeRef.current);

    // v0.2.21: Explicitly bind Escape to close the Find/Replace widget.
    // Out of the box Monaco's find widget binds Escape internally, but
    // our editor lives inside several React+FluentUI wrappers (the
    // bottom drawer, the Resource Explorer aside, the page-level
    // Dialog system) and any of them can swallow the bubbled Escape
    // event before Monaco sees it. The X button in the find widget
    // also dispatched `closeFindWidget` through the same chain, so
    // when Escape was blocked, the click was effectively a no-op for
    // the same reason. Forcing the editor-level keybinding fires the
    // action directly on the editor instance and routes around any
    // parent capture.
    const ed = editor as {
      addCommand?: (keybinding: number, handler: () => void, context?: string) => void;
      trigger?: (source: string, handlerId: string, payload: unknown) => void;
      getDomNode?: () => HTMLElement | null;
    };
    if (ed.addCommand && monaco.KeyCode) {
      ed.addCommand(monaco.KeyCode.Escape, () => {
        ed.trigger?.('keyboard', 'closeFindWidget', null);
      }, 'findWidgetVisible');
    }

    // v0.2.21 (follow-up): the find widget's X button shows its
    // "Close (Escape)" tooltip on hover — proving mouseover events
    // reach it — but the click does not fire `closeFindWidget`.
    // The cause is some parent in the React+FluentUI wrapper chain
    // intercepting the click event before Monaco's find controller
    // sees it. Wiring an explicit pointerdown delegate catches the
    // click on the close button (and on the sibling "Find Previous"/
    // "Find Next" controls if they ever exhibit the same problem) and
    // dispatches the action directly against the editor instance.
    // The find widget is an OVERLAY widget: it renders inline inside the
    // editor's own DOM (`.overlayWidgets` under getDomNode()), not in the
    // overflow host (which only parents content widgets like suggest/hover).
    // So bind the close-button delegate to the editor's DOM node.
    const listenerHost = ed.getDomNode?.() ?? null;
    if (listenerHost) {
      const findWidgetCloseHandler = (evt: PointerEvent): void => {
        const target = evt.target as HTMLElement | null;
        if (!target) return;
        // Walk up to Monaco's "close find widget" X (.codicon-widget-close).
        const closeBtn = target.closest(
          '.codicon-widget-close, [aria-label*="Close" i][aria-label*="Escape" i]',
        );
        if (closeBtn) {
          evt.preventDefault();
          evt.stopPropagation();
          ed.trigger?.('mouse', 'closeFindWidget', null);
        }
      };
      // Capture phase so we run BEFORE whatever's swallowing the event.
      listenerHost.addEventListener('pointerdown', findWidgetCloseHandler, true);
      // Detach when Monaco disposes the editor so the listener (and its
      // closure over `ed`) can't survive unmount and accumulate.
      const edDispose = editor as {
        onDidDispose?: (cb: () => void) => { dispose: () => void } | void;
      };
      edDispose.onDidDispose?.(() => {
        listenerHost.removeEventListener('pointerdown', findWidgetCloseHandler, true);
      });
    }

    // PR24/26: track cursor → resource context for the CIS sidebar.
    // PR27 reuses the same context for the rationale sidebar, so we
    // wire up tracking whenever EITHER feature is active.
    if (showCisCrossref || manifestId) {
      const edCtx = editor as {
        onDidChangeCursorPosition?: (cb: (e: { position: { lineNumber: number } }) => void) => void;
        getModel?: () => { getLineContent: (n: number) => string; getLineCount: () => number } | null;
      };
      if (edCtx?.onDidChangeCursorPosition && edCtx.getModel) {
        edCtx.onDidChangeCursorPosition((e) => {
          const model = edCtx.getModel?.();
          if (!model) return;
          const ctx = findResourceContextAtLine(model, e.position.lineNumber);
          setCisActiveCtx(ctx);
          setCisDismissed(false);
        });
      }
    }
  };

  // Validate on language change, platform change, or initial load
  useEffect(() => {
    if ((language === 'yaml' || language === 'json') && value) {
      validateContent(value, language);
    } else {
      setValidationMessages([]);
    }
  }, [language, validateContent, value, platform]);

  // PR24/26: when the active resource context changes, look it up
  // against the CIS rule catalog. Cache by a composite key so the
  // strict-vs-fallback decision is preserved.
  useEffect(() => {
    if (!showCisCrossref || !cisActiveCtx) {
      setCisLookup(null);
      return;
    }
    const cacheKey = [
      cisActiveCtx.name,
      cisActiveCtx.type ?? '',
      cisActiveCtx.propertyName ?? '',
      cisActiveCtx.propertySubcategory ?? '',
    ].join('|');
    const cached = cisLookupCacheRef.current.get(cacheKey);
    if (cached !== undefined) {
      setCisLookup(cached);
      return;
    }
    let cancelled = false;
    setCisLoading(true);
    cfs.cis
      .lookup({
        name: cisActiveCtx.name,
        type: cisActiveCtx.type,
        innerType: cisActiveCtx.innerType,
        propertyName: cisActiveCtx.propertyName,
        propertySubcategory: cisActiveCtx.propertySubcategory,
        registryKeyPath: cisActiveCtx.registryKeyPath,
        registryValueName: cisActiveCtx.registryValueName,
        path: cisActiveCtx.path,
      })
      .then((body) => {
        if (cancelled) return;
        const match = (body?.match ?? null) as CisLookupResult | null;
        cisLookupCacheRef.current.set(cacheKey, match);
        setCisLookup(match);
      })
      .catch(() => {
        if (cancelled) return;
        cisLookupCacheRef.current.set(cacheKey, null);
        setCisLookup(null);
      })
      .finally(() => {
        if (!cancelled) setCisLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cisActiveCtx, showCisCrossref]);

  const errors = validationMessages.filter(m => m.severity === 'error');
  const warnings = validationMessages.filter(m => m.severity === 'warning');
  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;
  const hasUnregistered = unregisteredTypes.length > 0;
  const allIssues = validationMessages;
  const showPanel = allIssues.length > 0;
  // PR28: bottom drawer for CIS + Rationale. Renders only when the
  // user has clicked a resource (cisActiveName != null). The editor
  // and drawer share a vertical flex column; Monaco's automaticLayout
  // resizes when the drawer expands/collapses.
  const showBottomDrawer = (showCisCrossref || !!manifestId) && !!cisActiveName && !cisDismissed;

  // Pick panel chrome color based on highest severity
  const panelBorder = hasErrors ? 'border-red-800' : hasWarnings ? 'border-amber-800' : 'border-blue-800';
  const panelBg = hasErrors ? 'bg-red-950/60' : hasWarnings ? 'bg-amber-950/50' : 'bg-blue-950/50';
  const panelTextColor = hasErrors ? 'text-red-400' : hasWarnings ? 'text-amber-300' : 'text-blue-300';
  const panelHover = hasErrors ? 'hover:bg-red-950/80' : hasWarnings ? 'hover:bg-amber-950/80' : 'hover:bg-blue-950/80';
  const panelIconColor = hasErrors ? 'text-red-500' : hasWarnings ? 'text-amber-400' : 'text-blue-400';
  const panelDivider = hasErrors ? 'border-red-900/50' : hasWarnings ? 'border-amber-900/50' : 'border-blue-900/50';

  // ── Resource Explorer ──
  const resourceIndex = useMemo(() => {
    if (!showResourceExplorer || !value) return [];
    return indexResourcesFromYaml(value);
  }, [showResourceExplorer, value]);

  const resourceGroups = useMemo(() => {
    const groups = new Map<string, ResourceIndexEntry[]>();
    for (const r of resourceIndex) {
      const list = groups.get(r.type) ?? [];
      list.push(r);
      groups.set(r.type, list);
    }
    return groups;
  }, [resourceIndex]);

  const [explorerFilter, setExplorerFilter] = useState('');
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(() => new Set());
  const [explorerCollapsed, setExplorerCollapsed] = useState(false);
  // PR28: reference panels (CIS + Rationale) live in a bottom drawer.
  // Default-collapsed via initialTab=undefined; user opts in per tab.
  // Drawer state is managed inside <EditorBottomDrawer>.

  const filteredGroups = useMemo(() => {
    if (!explorerFilter.trim()) return resourceGroups;
    const q = explorerFilter.trim().toLowerCase();
    const out = new Map<string, ResourceIndexEntry[]>();
    for (const [type, entries] of Array.from(resourceGroups.entries())) {
      const matched = entries.filter(
        (e) => e.name.toLowerCase().includes(q) || e.type.toLowerCase().includes(q),
      );
      if (matched.length > 0) out.set(type, matched);
    }
    return out;
  }, [resourceGroups, explorerFilter]);

  const scrollToLine = useCallback((line: number) => {
    const ed = editorRef.current as {
      revealLineInCenter?: (line: number) => void;
      setPosition?: (pos: { lineNumber: number; column: number }) => void;
      focus?: () => void;
    } | null;
    if (ed) {
      ed.revealLineInCenter?.(line);
      ed.setPosition?.({ lineNumber: line, column: 1 });
      ed.focus?.();
    }
  }, []);

  const toggleType = useCallback((type: string) => {
    setExpandedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  return (
    <div className="flex h-full w-full overflow-hidden rounded-md border border-slate-700">
      {showResourceExplorer && resourceIndex.length > 0 && !explorerCollapsed && (
        <aside className="flex h-full w-40 shrink-0 flex-col border-r border-slate-700 bg-slate-950/60 text-xs">
          <div className="flex items-center justify-between border-b border-slate-700 px-2 py-1.5">
            <span className="flex items-center gap-1.5 font-semibold text-slate-300">
              <ListRegular className="h-3.5 w-3.5" />
              Resources ({resourceIndex.length})
            </span>
            <button
              onClick={() => setExplorerCollapsed(true)}
              className="rounded p-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
              title="Collapse explorer"
            >
              <ChevronDownRegular className="h-3 w-3 -rotate-90" />
            </button>
          </div>
          <div className="border-b border-slate-700 px-2 py-1.5">
            <div className="relative">
              <SearchRegular className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Filter resources…"
                value={explorerFilter}
                onChange={(e) => setExplorerFilter(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-900 py-1 pl-6 pr-2 text-xs text-slate-300 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {Array.from(filteredGroups.entries()).map(([type, entries]) => {
              const shortType = type.replace('Microsoft.', '').replace('OSConfig/', '');
              const isExpanded = expandedTypes.has(type) || !!explorerFilter.trim();
              return (
                <div key={type}>
                  <button
                    onClick={() => toggleType(type)}
                    className="flex w-full items-center gap-1 px-2 py-1.5 text-left text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  >
                    <ChevronRightRegular
                      className={`h-3 w-3 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    />
                    <span className="truncate font-medium">{shortType}</span>
                    <span className="ml-auto shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
                      {entries.length}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="pb-1">
                      {entries.map((entry, idx) => (
                        <button
                          key={`${entry.line}-${idx}`}
                          onClick={() => scrollToLine(entry.line)}
                          className="block w-full truncate px-6 py-0.5 text-left text-slate-400 hover:bg-blue-900/30 hover:text-blue-300"
                          title={`Line ${entry.line}: ${entry.name}`}
                        >
                          {entry.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>
      )}
      {showResourceExplorer && resourceIndex.length > 0 && explorerCollapsed && (
        <button
          onClick={() => setExplorerCollapsed(false)}
          className="flex h-full w-8 shrink-0 items-center justify-center border-r border-slate-700 bg-slate-950/60 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
          title="Show Resource Explorer"
        >
          <ListRegular className="h-4 w-4" />
        </button>
      )}
      <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1">
      {/*
        Diff dropdown freeze fix: Monaco's overflow widgets (find dialog,
        suggest popup, hover, parameter hints) are hosted in `overflowHostRef`
        — a div this component creates with document.createElement, appends to
        <body> (see the useLayoutEffect above), and removes on unmount. With
        `fixedOverflowWidgets` the widgets render position:fixed; the default
        host is <body>, where disposing the editor while a widget was alive —
        or racing React unmount during rapid navigation — could leave an
        orphaned, invisible, click-swallowing overlay that froze the Diff
        "Select manifest" dropdown until app restart. Owning + removing the
        host guarantees no orphan survives. The host is intentionally NOT a JSX
        node: a React-rendered node carries Fiber expandos that make Monaco's
        deep-clone of the options recurse infinitely and crash (see the ref
        declaration). <body> has no transformed ancestor, so the fixed widgets
        are not clipped.
      */}
      <Editor
        key={language}
        defaultLanguage={language}
        value={value ?? PLACEHOLDER}
        onChange={handleChange}
        onMount={handleEditorMount}
        theme="vs-dark"
        height={height}
        options={{
          readOnly,
          minimap: { enabled: false },
          lineNumbers: "on",
          fontSize: 13,
          fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
          scrollBeyondLastLine: false,
          wordWrap: "on",
          tabSize: 2,
          automaticLayout: true,
          fixedOverflowWidgets: true,
          overflowWidgetsDomNode: overflowHostRef.current,
          padding: { top: 12 },
        }}
      />
      </div>
      {showPanel && (
        <div className={`border-t ${panelBorder} ${panelBg}`}>
          {/* Summary bar — always visible */}
          <button
            onClick={() => setPanelExpanded(!panelExpanded)}
            className={`flex w-full items-center gap-2 px-3 py-2 text-xs ${panelTextColor} ${panelHover} transition-colors`}
          >
            {hasErrors ? (
              <DismissCircleRegular className={`h-3.5 w-3.5 shrink-0 ${panelIconColor}`} />
            ) : hasWarnings ? (
              <WarningRegular className={`h-3.5 w-3.5 shrink-0 ${panelIconColor}`} />
            ) : (
              <InfoRegular className={`h-3.5 w-3.5 shrink-0 ${panelIconColor}`} />
            )}
            <span className="font-semibold">
              {allIssues.length} {allIssues.length === 1 ? 'issue' : 'issues'}
            </span>
            {/* Collapsed-only preview of the first issue. When expanded, the
                full list below already shows the same text — repeating it in
                the summary bar created a visual duplicate. */}
            {!panelExpanded && (
              <span className={`truncate opacity-80`}>{allIssues[0].text}</span>
            )}
            <span className="ml-auto shrink-0">
              {panelExpanded ? <ChevronDownRegular className="h-3.5 w-3.5" /> : <ChevronUpRegular className="h-3.5 w-3.5" />}
            </span>
          </button>
          {/* Expanded list */}
          {panelExpanded && (
            <div className={`max-h-[120px] overflow-y-auto border-t ${panelDivider} px-3 py-1`}>
              {allIssues.map((msg, i) => {
                const iconColor = msg.severity === 'error' ? 'text-red-500' : msg.severity === 'warning' ? 'text-amber-400' : 'text-blue-400';
                const textColor = msg.severity === 'error' ? 'text-red-400' : msg.severity === 'warning' ? 'text-amber-300' : 'text-blue-300';
                return (
                  <div key={i} className={`flex items-start gap-2 py-1 text-xs ${textColor}`}>
                    {msg.severity === 'info' ? (
                      <InfoRegular className={`mt-0.5 h-3 w-3 shrink-0 ${iconColor}`} />
                    ) : (
                      <WarningRegular className={`mt-0.5 h-3 w-3 shrink-0 ${iconColor}`} />
                    )}
                    <span>{msg.text}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {hasUnregistered && (
        <div
          className="flex items-center gap-2 border-t border-amber-800/70 bg-amber-950/50 px-3 py-1.5 text-xs text-amber-300"
          title="These types aren't registered in the bundled CLI on this host. Apply may fail until the CLI is upgraded."
        >
          <WarningRegular className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          <span className="font-semibold">Unregistered on this CLI:</span>
          <span className="truncate text-amber-300/90">{unregisteredTypes.join(', ')}</span>
        </div>
      )}
      {showBottomDrawer && (
        <EditorBottomDrawer
          tabs={[
            ...(showCisCrossref
              ? [
                  {
                    id: 'cis',
                    label: 'CIS reference',
                    icon: cisLoading ? (
                      <ShieldCheckmarkRegular className="h-3.5 w-3.5 text-emerald-400" />
                    ) : cisLookup ? (
                      <CheckmarkCircleRegular className="h-3.5 w-3.5 text-emerald-400" title="CIS rule matched" />
                    ) : (
                      <ShieldCheckmarkRegular className="h-3.5 w-3.5 text-slate-500" title="No CIS rule mapped" />
                    ),
                    badge: cisLoading ? (
                      <SpinnerIosRegular className="h-3 w-3 animate-spin text-slate-500" />
                    ) : cisLookup ? (
                      <span className="flex items-center gap-1">
                        <span className="rounded-full border border-emerald-700/60 bg-emerald-900/40 px-1.5 py-0 text-[10px] font-semibold uppercase text-emerald-300" title="Click tab to view matched CIS rule">
                          Matched
                        </span>
                        {cisLookup.severity && (
                          <span className={`rounded-full border px-1.5 py-0 text-[10px] uppercase ${cisSeverityClass(cisLookup.severity)}`}>
                            {cisLookup.severity}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="rounded-full border border-slate-700 bg-slate-800/60 px-1.5 py-0 text-[10px] uppercase text-slate-400" title="This resource has no direct CIS rule mapping in the loaded benchmarks">
                        No map
                      </span>
                    ),
                    content: (
                      <CisCrossrefSidebar
                        activeName={cisActiveName}
                        loading={cisLoading}
                        match={cisLookup}
                        onDismiss={() => setCisDismissed(true)}
                      />
                    ),
                  } satisfies DrawerTab,
                ]
              : []),
            ...(manifestId
              ? [
                  {
                    id: 'rationale',
                    label: 'Recent rationale',
                    icon: <HistoryRegular className="h-3.5 w-3.5 text-blue-400" />,
                    content: (
                      <RecentRationaleSidebar
                        manifestId={manifestId}
                        resourceName={cisActiveName}
                        limit={3}
                        mode="drawer"
                      />
                    ),
                  } satisfies DrawerTab,
                ]
              : []),
          ]}
        />
      )}
      </div>
    </div>
  );
}

/**
 * Resource index entry for the Resource Explorer sidebar.
 * Parsed from YAML text using lightweight line-by-line scanning
 * (same approach as findResourceContextAtLine but for all resources).
 */
interface ResourceIndexEntry {
  name: string;
  type: string;
  line: number;
}

/**
 * Scan YAML text for all `- name: ...` + `type: ...` resource entries.
 * Returns an array of {name, type, line} sorted by line number.
 * Lightweight: regex-based, no full YAML parse.
 */
function indexResourcesFromYaml(text: string): ResourceIndexEntry[] {
  const lines = text.split('\n');
  const NAME_RE = /^(\s*)-\s*name\s*:\s*(.+?)\s*$/;
  const TYPE_RE = /^\s+type\s*:\s*(.+?)\s*$/;
  const entries: ResourceIndexEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const nameMatch = lines[i].match(NAME_RE);
    if (!nameMatch) continue;

    const name = unquote(nameMatch[2].trim());
    if (!name) continue;
    const indent = nameMatch[1].length;

    // Look ahead for the type field (within 10 lines, same block).
    let type = 'unknown';
    for (let j = i + 1; j < Math.min(lines.length, i + 10); j++) {
      const line = lines[j];
      if (!line.trim()) continue;
      const lineIndent = (line.match(/^(\s*)/) ?? ['', ''])[1].length;
      // Next resource at same indent = stop.
      if (lineIndent === indent && line.trimStart().startsWith('-')) break;
      const typeMatch = line.match(TYPE_RE);
      if (typeMatch) {
        type = unquote(typeMatch[1].trim());
        break;
      }
    }

    entries.push({ name, type, line: i + 1 }); // 1-based line number
  }

  return entries;
}

/**
 * PR24: Walk back from `lineNumber` to find the most recent
 * `- name: "..."` entry inside a top-level `resources:` array. Returns
 * the (unquoted) name, or `null` if the cursor isn't inside a resource.
 *
 * Lightweight regex-based scan rather than re-parsing the full YAML —
 * the editor calls this on every cursor move so it must be cheap.
 */
interface ResourceContext {
  /** The resource's `- name:` value (top-level scalar). */
  name: string;
  /** The resource's `type:` value (sibling of name), if found. */
  type: string | null;
  /** Inner `properties.resource.type:` value (e.g. `Microsoft.Windows/CSP`). */
  innerType: string | null;
  /** PR26: `properties.name` — used for the OSConfig->CIS fallback lookup. */
  propertyName: string | null;
  /** PR26: `properties.subcategory` — for AuditPolicy GUID lookup. */
  propertySubcategory: string | null;
  /** v0.3.5: registry keyPath for XCCDF OVAL matching. */
  registryKeyPath: string | null;
  /** v0.3.5: registry valueName for XCCDF OVAL matching. */
  registryValueName: string | null;
  /**
   * v0.3.24: CSP policy path (`properties.resource.properties.path`), e.g.
   * `./Vendor/MSFT/Policy/Result/LocalPoliciesSecurityOptions/NetworkAccess_AllowAnonymousSIDOrNameTranslation`.
   * Feeds the XCCDF fuzzy-title fallback so CSP resources without a
   * registry key still map to CIS rules.
   */
  path: string | null;
}

function findResourceContextAtLine(
  model: { getLineContent: (n: number) => string; getLineCount: () => number },
  lineNumber: number,
): ResourceContext | null {
  const NAME_RE = /^(\s*)-\s*name\s*:\s*(.+?)\s*$/;
  // Find the start of this resource (walk backwards).
  let resourceLine = -1;
  let resourceIndent = 0;
  for (let i = lineNumber; i >= 1; i--) {
    const line = model.getLineContent(i);
    const m = line.match(NAME_RE);
    if (m) {
      resourceLine = i;
      resourceIndent = m[1].length;
      break;
    }
  }
  if (resourceLine === -1) return null;

  const ctx: ResourceContext = {
    name: unquote(model.getLineContent(resourceLine).match(NAME_RE)?.[2]?.trim() ?? ''),
    type: null,
    innerType: null,
    propertyName: null,
    propertySubcategory: null,
    registryKeyPath: null,
    registryValueName: null,
    path: null,
  };
  if (!ctx.name) return null;

  // Walk forward to extract type + properties.name + properties.subcategory.
  // Stop at next `-` at the same indent (start of next resource) or 80 lines max.
  const total = model.getLineCount();
  let inProperties = false;
  let propertiesIndent = -1;
  for (let i = resourceLine + 1; i <= Math.min(total, resourceLine + 80); i++) {
    const line = model.getLineContent(i);
    if (!line.trim()) continue;
    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1].length : 0;
    // Same-indent `-` => next resource boundary.
    if (indent === resourceIndent && line.trimStart().startsWith('-')) break;
    // Sibling `type:` of the resource name (one level deeper than `- name:`).
    if (!ctx.type && /^\s+type\s*:/.test(line)) {
      const m = line.match(/^\s+type\s*:\s*(.+?)\s*$/);
      if (m) ctx.type = unquote(m[1].trim());
    } else if (!ctx.innerType && /^\s+type\s*:/.test(line)) {
      const m = line.match(/^\s+type\s*:\s*(.+?)\s*$/);
      if (m) ctx.innerType = unquote(m[1].trim());
    }
    if (/^\s+properties\s*:\s*$/.test(line)) {
      inProperties = true;
      propertiesIndent = indent;
      continue;
    }
    if (inProperties) {
      // We've left the properties block once indent drops back below it.
      if (indent <= propertiesIndent && line.trim()) {
        inProperties = false;
        continue;
      }
      const nameMatch = line.match(/^\s+name\s*:\s*(.+?)\s*$/);
      if (nameMatch && !ctx.propertyName) ctx.propertyName = unquote(nameMatch[1].trim());
      const subMatch = line.match(/^\s+subcategory\s*:\s*(.+?)\s*$/);
      if (subMatch && !ctx.propertySubcategory) ctx.propertySubcategory = unquote(subMatch[1].trim());
      const keyPathMatch = line.match(/^\s+keyPath\s*:\s*(.+?)\s*$/);
      if (keyPathMatch && !ctx.registryKeyPath) ctx.registryKeyPath = unquote(keyPathMatch[1].trim());
      const valueNameMatch = line.match(/^\s+valueName\s*:\s*(.+?)\s*$/);
      if (valueNameMatch && !ctx.registryValueName) ctx.registryValueName = unquote(valueNameMatch[1].trim());
      // v0.3.24: capture CSP policy `path:` for fuzzy XCCDF matching.
      const pathMatch = line.match(/^\s+path\s*:\s*(.+?)\s*$/);
      if (pathMatch && !ctx.path) ctx.path = unquote(pathMatch[1].trim());
      // Capture nested `properties.resource.type` (the inner resource type).
      const typeMatch = line.match(/^\s+type\s*:\s*(.+?)\s*$/);
      if (typeMatch && !ctx.innerType) ctx.innerType = unquote(typeMatch[1].trim());
    }
  }
  return ctx;
}

function unquote(raw: string): string {
  if (!raw) return raw;
  let s = raw;
  const hashIdx = s.indexOf(' #');
  if (hashIdx >= 0) s = s.slice(0, hashIdx).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    const q = s[0];
    s = s.slice(1, -1).replace(new RegExp(q + q, 'g'), q);
  }
  return s;
}

function CisCrossrefSidebar({
  activeName,
  loading,
  match,
  onDismiss,
}: {
  activeName: string | null;
  loading: boolean;
  match: CisLookupResult | null;
  onDismiss: () => void;
}) {
  const isFallback = match?.matchSource === 'property-mapping';
  const displayName = match?.title ?? match?.name ?? '';
  const matchSrc = match?.source ?? (isFallback ? 'property-mapping' : 'json');
  const confidenceFormatter = useNumberFormatter({ maximumFractionDigits: 0 });
  const isAzurePolicy = matchSrc === 'azure-policy';
  const isXccdf = matchSrc === 'xccdf';

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 border-b border-slate-800 px-3 py-2 text-slate-300">
        <ShieldCheckmarkRegular className="h-3.5 w-3.5 text-emerald-400" />
        <span className="font-semibold">CIS cross-reference</span>
        <button
          onClick={onDismiss}
          className="ml-auto rounded p-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
          title="Hide CIS sidebar"
        >
          <CloseIcon className="h-3 w-3" />
        </button>
      </div>
      <div className="overflow-y-auto p-3">
        {!activeName && (
          <div className="text-slate-500">Click a resource in the editor to see its CIS rule.</div>
        )}
        {activeName && loading && (
          <div className="flex items-center gap-1.5 text-slate-400">
            <SpinnerIosRegular className="h-3 w-3 animate-spin" />
            Looking up &quot;{activeName}&quot;...
          </div>
        )}
        {activeName && !loading && !match && (
          <div className="space-y-1">
            <div className="text-slate-300">
              <span className="font-mono">{activeName}</span>
            </div>
            <div className="text-slate-500">No CIS rule mapped for this resource.</div>
          </div>
        )}
        {activeName && !loading && match && (
          <div className="space-y-2">
            {isFallback && (
              <div className="rounded-md border border-amber-700/50 bg-amber-900/20 p-2 text-[11px] text-amber-200">
                <div className="font-semibold">Mapped via OSConfig property. Verify before using.</div>
                <div className="mt-0.5 text-amber-300/80">
                  Confidence: {confidenceFormatter.format((typeof match.confidence === 'number' ? match.confidence : 0.7) * 100)}%.
                </div>
              </div>
            )}
            {displayName && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">CIS Rule</div>
                <div className="text-slate-100">{displayName}</div>
              </div>
            )}
            {match.ruleId && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Rule ID</div>
                <div className="break-all font-mono text-[11px] text-slate-300">{match.ruleId}</div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {match.severity && (
                <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${cisSeverityClass(match.severity)}`}>
                  {match.severity}
                </span>
              )}
              {match.osVersion && (
                <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
                  WS{match.osVersion}
                </span>
              )}
              {match.benchmark && (
                <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
                  {match.benchmark}
                </span>
              )}
              <span className={`rounded-full border px-2 py-0.5 text-[10px] ${
                isAzurePolicy ? 'border-blue-700/50 bg-blue-900/20 text-blue-300'
                  : isXccdf ? 'border-emerald-700/50 bg-emerald-900/20 text-emerald-300'
                  : 'border-slate-700 bg-slate-800 text-slate-400'
              }`}>
                {isAzurePolicy ? 'Azure Policy' : isXccdf ? 'XCCDF' : isFallback ? 'property mapping' : 'JSON catalog'}
              </span>
            </div>
            {match.description && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Details</div>
                <div className="break-words text-[11px] text-slate-300">{match.description}</div>
              </div>
            )}
            {match.gpoPath && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">GPO Path</div>
                <div className="break-words text-[11px] text-slate-300">{match.gpoPath}</div>
              </div>
            )}
            {match.fixtext && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Remediation</div>
                <div className="max-h-32 overflow-y-auto break-words text-[11px] text-slate-300">{match.fixtext}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


function cisSeverityClass(severity: string): string {
  const s = severity.toLowerCase();
  if (s === 'critical') return 'bg-red-900/60 text-red-300 border-red-800';
  if (s === 'important') return 'bg-amber-900/60 text-amber-300 border-amber-800';
  if (s === 'warning') return 'bg-yellow-900/60 text-yellow-300 border-yellow-800';
  if (s === 'informational') return 'bg-blue-900/60 text-blue-300 border-blue-800';
  return 'bg-slate-800 text-slate-300 border-slate-700';
}

/** @deprecated Use ConfigEditor instead */
export const ManifestEditor = ConfigEditor;
