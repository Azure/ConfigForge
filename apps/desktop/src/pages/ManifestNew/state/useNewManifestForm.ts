// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useCallback, useEffect, useRef, useState } from "react";
import yaml from "js-yaml";
import { type Platform, getValidTypesForPlatform } from "@configforge/core/platform";
import { cfs } from "../../../lib/cfs";
import {
  dumpVisualManifest,
  parseLosslessJson,
  parseVisualManifest,
  stringifyLosslessJson,
} from "../../ManifestEditor/visual-viewer";

export const WINDOWS_DEFAULT_YAML = `$schema: https://aka.ms/osc/schemas/prerelease/document.json
resources:
  - name: "ExampleSetting"
    type: Microsoft.Windows/Registry
    properties:
      keyPath: "HKLM:\\\\SOFTWARE\\\\Policies\\\\..."
      valueName: "ValueName"
      valueType: Dword
    compliance:
      equals: 0
`;

export const LINUX_DEFAULT_YAML = `$schema: https://aka.ms/osc/schemas/prerelease/document.json
resources:
  - name: "ExampleSetting"
    type: Microsoft.OSConfig/FileLine
    properties:
      path: "/etc/sysctl.conf"
      find: "net.ipv4.ip_forward"
      replace: "net.ipv4.ip_forward = 0"
      append: true
    compliance:
      equals: "net.ipv4.ip_forward = 0"
`;

export type SourceType = "content" | "uri";
export type BuilderTab = "yaml" | "json" | "visual";

export interface ImportResult {
  type: string;
  filename: string;
  data: Record<string, unknown>;
}

export interface UseNewManifestFormOptions {
  /** Optional override for the import IPC client. Tests pass a mock. */
  importClient?: typeof cfs.importChannel;
}

/**
 * Owns the new-manifest form: name, platform, YAML/JSON content buffers,
 * sync between them, platform switching, and file import. The spreadsheet
 * visual editor writes directly to the canonical YAML buffer.
 *
 * Submit, docs modal, navigation guard, and post-register banner remain
 * page-level because they depend on routing / shared infra.
 */
export function useNewManifestForm(options: UseNewManifestFormOptions = {}) {
  const importClient = options.importClient ?? cfs.importChannel;

  const [name, setName] = useState("");
  const [platform, setPlatform] = useState<Platform>("windows");
  const [yamlContent, setYamlContent] = useState(WINDOWS_DEFAULT_YAML);
  // jsonContent is a separate edit buffer for the JSON tab. yamlContent
  // remains the canonical source of truth used by submit, docs gen,
  // platform switch, and the visual editor; jsonContent is
  // derived from yamlContent on tab-switch and any valid edit in JSON
  // is propagated back to yamlContent immediately so the rest of the
  // flow stays consistent.
  const [jsonContent, setJsonContent] = useState("");
  const [uri, setUri] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("content");
  const [activeTab, setActiveTab] = useState<BuilderTab>("yaml");
  const [platformWarning, setPlatformWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const syncYamlToJson = useCallback(() => {
    try {
      const parsed = parseVisualManifest(yamlContent);
      setJsonContent(stringifyLosslessJson(parsed ?? {}, 2) ?? "{}");
    } catch {
      // Invalid YAML: keep whatever was in jsonContent.
    }
  }, [yamlContent]);

  const handleTabSwitch = useCallback(
    (tab: BuilderTab) => {
      if (tab === "json" && activeTab !== "json") {
        syncYamlToJson();
      }
      setActiveTab(tab);
    },
    [activeTab, syncYamlToJson],
  );

  const handleJsonChange = useCallback((newJson: string) => {
    setJsonContent(newJson);
    try {
      const parsed = parseLosslessJson(newJson);
      setYamlContent(dumpVisualManifest(parsed));
    } catch {
      // Mid-edit invalid JSON: leave yamlContent at last valid state.
    }
  }, []);

  const handlePlatformSwitch = useCallback(
    (newPlatform: Platform) => {
      if (newPlatform === platform) return;

      try {
        const parsed = yaml.load(yamlContent) as Record<string, unknown> | null;
        if (parsed && Array.isArray(parsed.resources)) {
          const validTypes = getValidTypesForPlatform(newPlatform);
          const incompatible = (parsed.resources as { type?: string }[]).filter(
            (r) => r.type && !validTypes.includes(r.type),
          );
          if (incompatible.length > 0) {
            const types = incompatible.map((r) => r.type).join(", ");
            setPlatformWarning(
              `Switching to ${newPlatform === "windows" ? "Windows" : "Linux"}. ${incompatible.length} resource(s) use incompatible types (${types}) and will show validation errors.`,
            );
          } else {
            setPlatformWarning(null);
          }
        }
      } catch {
        setPlatformWarning(null);
      }

      setPlatform(newPlatform);

      // Reset to platform-appropriate default if the content is still the default
      const isDefaultWindows = yamlContent.trim() === WINDOWS_DEFAULT_YAML.trim();
      const isDefaultLinux = yamlContent.trim() === LINUX_DEFAULT_YAML.trim();
      if (isDefaultWindows || isDefaultLinux) {
        setYamlContent(newPlatform === "windows" ? WINDOWS_DEFAULT_YAML : LINUX_DEFAULT_YAML);
        setPlatformWarning(null);
      }
    },
    [platform, yamlContent],
  );

  const handleImport = useCallback(
    async (file: File) => {
      setImporting(true);
      setError(null);
      setImportResult(null);

      try {
        const request = file.name.toLowerCase().endsWith(".xlsx")
          ? {
              filename: file.name,
              bytes: new Uint8Array(await file.arrayBuffer()),
            }
          : {
              filename: file.name,
              content: await file.text(),
            };
        const result = await importClient.fromContent(request);

        if (result.yaml) {
          setYamlContent(result.yaml);
          setSourceType("content");
          setActiveTab("yaml");
        }

        setImportResult({
          type: result.type,
          filename: result.filename,
          data: (result as { data?: unknown }).data as Record<string, unknown>,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Import failed");
      } finally {
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [importClient],
  );

  const clearImport = useCallback(() => {
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const applyTemplate = useCallback(
    (content: string, templateName: string, templatePlatform: Platform) => {
      setYamlContent(content);
      setSourceType("content");
      setActiveTab("yaml");
      setName(templateName.replace(/[^a-zA-Z0-9_-]/g, "-").substring(0, 64));
      setPlatform(templatePlatform);
      requestAnimationFrame(() => window.scrollTo(0, 0));
    },
    [],
  );

  /** Hydrate form from sessionStorage when navigated from Baseline Library. */
  const hydrateFromLibraryTemplate = useCallback((): boolean => {
    const content = sessionStorage.getItem("baseline-template-content");
    const templateName = sessionStorage.getItem("baseline-template-name");
    const templatePlatform = sessionStorage.getItem("baseline-template-platform") as Platform | null;
    const validPlatform =
      templatePlatform === "windows" || templatePlatform === "linux" ? templatePlatform : null;

    if (content) {
      applyTemplate(content, templateName ?? "Microsoft-Baseline", validPlatform ?? "windows");
    }

    sessionStorage.removeItem("baseline-template-content");
    sessionStorage.removeItem("baseline-template-name");
    sessionStorage.removeItem("baseline-template-platform");

    // After hydrating a large template (e.g. WS2025 with 294
    // resources), Monaco's setValue triggers a layout pass + cursor
    // placement that can scroll the page. Re-scroll to top after a
    // rAF so the browser's layout is flushed first.
    return Boolean(content);
  }, [applyTemplate]);

  /** True iff the user has typed or imported anything beyond the default scaffold. */
  const hasUserContent = useCallback(
    () =>
      name.trim() !== "" ||
      (yamlContent.trim() !== WINDOWS_DEFAULT_YAML.trim() &&
        yamlContent.trim() !== LINUX_DEFAULT_YAML.trim()) ||
      uri.trim() !== "",
    [name, yamlContent, uri],
  );

  // (Re-using the same ref guard pattern as ManifestEditor/Manifests
  // ensures Strict-Mode double-mount doesn't double-fire effects in
  // dev. The form fields themselves don't schedule timers, so no
  // cleanup is needed here.)
  useEffect(() => {
    // intentionally empty — placeholder for future mount-only effects
  }, []);

  return {
    // form fields
    name,
    setName,
    platform,
    yamlContent,
    setYamlContent,
    jsonContent,
    uri,
    setUri,
    sourceType,
    setSourceType,
    activeTab,
    platformWarning,
    setPlatformWarning,
    // import
    fileInputRef,
    importing,
    importResult,
    // shared error
    error,
    setError,
    // handlers
    handleTabSwitch,
    handleJsonChange,
    handlePlatformSwitch,
    handleImport,
    clearImport,
    syncYamlToJson,
    applyTemplate,
    hydrateFromLibraryTemplate,
    hasUserContent,
  };
}
