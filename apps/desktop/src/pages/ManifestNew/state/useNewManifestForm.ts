// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useCallback, useEffect, useRef, useState } from "react";
import yaml from "js-yaml";
import { type Platform, getValidTypesForPlatform } from "@configforge/core/platform";
import { cfs } from "../../../lib/cfs";

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

export interface VisualResource {
  name: string;
  type: string;
  properties: Record<string, unknown>;
  compliance?: { equals: unknown };
}

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
 * Owns the new-manifest form: name, platform, yaml/json/visual content
 * buffers, sync between them, platform switching, file import, and
 * resource-picker integration.
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
  // platform switch, and the visual builder sync; jsonContent is
  // derived from yamlContent on tab-switch and any valid edit in JSON
  // is propagated back to yamlContent immediately so the rest of the
  // flow stays consistent.
  const [jsonContent, setJsonContent] = useState("");
  const [uri, setUri] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("content");
  const [activeTab, setActiveTab] = useState<BuilderTab>("yaml");
  const [visualResources, setVisualResources] = useState<VisualResource[]>([]);
  const [platformWarning, setPlatformWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const syncResourcesToVisual = useCallback(() => {
    try {
      const parsed = yaml.load(yamlContent) as Record<string, unknown> | null;
      if (parsed && Array.isArray(parsed.resources)) {
        const resources = (parsed.resources as Record<string, unknown>[])
          .map((r) => ({
            name: String(r.name ?? r.Name ?? ""),
            type: String(r.type ?? r.Type ?? ""),
            properties: (r.properties ?? r.Properties ?? {}) as Record<string, unknown>,
            compliance: r.compliance as { equals: unknown } | undefined,
          }))
          .filter((r) => r.name || r.type);
        setVisualResources(resources);
      }
    } catch {
      // If YAML can't be parsed, keep existing visual resources
    }
  }, [yamlContent]);

  const syncYamlToJson = useCallback(() => {
    try {
      const parsed = yaml.load(yamlContent);
      setJsonContent(JSON.stringify(parsed ?? {}, null, 2));
    } catch {
      // Invalid YAML: keep whatever was in jsonContent.
    }
  }, [yamlContent]);

  const handleTabSwitch = useCallback(
    (tab: BuilderTab) => {
      if (tab === "visual" && activeTab !== "visual") {
        syncResourcesToVisual();
      }
      if (tab === "json" && activeTab !== "json") {
        syncYamlToJson();
      }
      setActiveTab(tab);
    },
    [activeTab, syncResourcesToVisual, syncYamlToJson],
  );

  const handleJsonChange = useCallback((newJson: string) => {
    setJsonContent(newJson);
    try {
      const parsed = JSON.parse(newJson);
      setYamlContent(
        yaml.dump(parsed, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: false }),
      );
    } catch {
      // Mid-edit invalid JSON: leave yamlContent at last valid state.
    }
  }, []);

  const handleResourceAdd = useCallback(
    (resource: VisualResource) => {
      setVisualResources((prev) => [...prev, resource]);
      try {
        const parsed = yaml.load(yamlContent) as Record<string, unknown> | null;
        const doc =
          parsed && typeof parsed === "object"
            ? parsed
            : { $schema: "https://aka.ms/osc/schemas/prerelease/document.json" };
        const existingResources = Array.isArray(doc.resources)
          ? (doc.resources as Record<string, unknown>[])
          : [];

        const newResource: Record<string, unknown> = {
          name: resource.name,
          type: resource.type,
          properties: resource.properties,
        };
        if (resource.compliance) {
          newResource.compliance = resource.compliance;
        }

        doc.resources = [...existingResources, newResource];
        setYamlContent(yaml.dump(doc, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: false }));
      } catch {
        // Fallback: append resource YAML as a string to the end of content.
        const resourceYaml = `  - name: "${resource.name}"\n    type: ${resource.type}\n    properties:\n${Object.entries(
          resource.properties,
        )
          .map(([k, v]) => `      ${k}: ${JSON.stringify(v)}`)
          .join("\n")}${
          resource.compliance ? `\n    compliance:\n      equals: ${JSON.stringify(resource.compliance.equals)}` : ""
        }`;

        if (yamlContent.includes("resources:")) {
          setYamlContent(yamlContent.trimEnd() + "\n" + resourceYaml + "\n");
        } else {
          setYamlContent(
            `$schema: https://aka.ms/osc/schemas/prerelease/document.json\nresources:\n${resourceYaml}\n`,
          );
        }
      }
    },
    [yamlContent],
  );

  /**
   * Remove a resource from BOTH the visual-builder state AND the YAML
   * source. Previously the Remove button only updated visualResources,
   * so switching to the YAML tab showed the original (stale) content
   * and any save would include the removed resource. Mirrors
   * handleResourceAdd's dual-write pattern.
   */
  const handleResourceRemove = useCallback(
    (index: number) => {
      setVisualResources((prev) => prev.filter((_, i) => i !== index));
      try {
        const parsed = yaml.load(yamlContent) as Record<string, unknown> | null;
        if (!parsed || typeof parsed !== "object") return;
        const existing = Array.isArray(parsed.resources)
          ? (parsed.resources as Record<string, unknown>[])
          : [];
        if (index < 0 || index >= existing.length) return;
        parsed.resources = existing.filter((_, i) => i !== index);
        setYamlContent(
          yaml.dump(parsed, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: false }),
        );
      } catch {
        // YAML couldn't be parsed cleanly — leave it alone and let the
        // user inspect manually. Visual state is still updated above.
      }
    },
    [yamlContent],
  );

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
        setVisualResources([]);
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
        const text = await file.text();
        const result = await importClient.fromContent({
          filename: file.name,
          content: text,
        });

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

  /** Hydrate form from sessionStorage when navigated from Baseline Library. */
  const hydrateFromLibraryTemplate = useCallback(() => {
    const content = sessionStorage.getItem("baseline-template-content");
    const templateName = sessionStorage.getItem("baseline-template-name");
    const templatePlatform = sessionStorage.getItem("baseline-template-platform") as Platform | null;

    if (content) {
      setYamlContent(content);
      setSourceType("content");
      setActiveTab("yaml");
    }
    if (templateName) {
      setName(templateName.replace(/[^a-zA-Z0-9_-]/g, "-").substring(0, 64));
    }
    if (templatePlatform === "windows" || templatePlatform === "linux") {
      setPlatform(templatePlatform);
    }

    sessionStorage.removeItem("baseline-template-content");
    sessionStorage.removeItem("baseline-template-name");
    sessionStorage.removeItem("baseline-template-platform");

    // After hydrating a large template (e.g. WS2025 with 294
    // resources), Monaco's setValue triggers a layout pass + cursor
    // placement that can scroll the page. Re-scroll to top after a
    // rAF so the browser's layout is flushed first.
    if (content) {
      requestAnimationFrame(() => window.scrollTo(0, 0));
    }
  }, []);

  /** True iff the user has typed or imported anything beyond the default scaffold. */
  const hasUserContent = useCallback(
    () =>
      name.trim() !== "" ||
      (yamlContent.trim() !== WINDOWS_DEFAULT_YAML.trim() &&
        yamlContent.trim() !== LINUX_DEFAULT_YAML.trim()) ||
      visualResources.length > 0 ||
      uri.trim() !== "",
    [name, yamlContent, visualResources, uri],
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
    visualResources,
    setVisualResources,
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
    handleResourceAdd,
    handleResourceRemove,
    handlePlatformSwitch,
    handleImport,
    syncResourcesToVisual,
    syncYamlToJson,
    hydrateFromLibraryTemplate,
    hasUserContent,
  };
}
