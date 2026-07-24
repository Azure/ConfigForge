// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import yaml from "js-yaml";
import {
  useNewManifestForm,
  WINDOWS_DEFAULT_YAML,
  LINUX_DEFAULT_YAML,
} from "./useNewManifestForm";
import { parseVisualManifest } from "../../ManifestEditor/visual-viewer";

function makeImportClient(
  fromContent: ReturnType<typeof vi.fn> = vi.fn(),
) {
  return { fromContent } as unknown as typeof import("../../../lib/cfs").cfs.importChannel;
}

describe("useNewManifestForm", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("starts with the Windows default YAML on the yaml tab in content-source mode", () => {
    const { result } = renderHook(() => useNewManifestForm({ importClient: makeImportClient() }));

    expect(result.current.name).toBe("");
    expect(result.current.platform).toBe("windows");
    expect(result.current.yamlContent).toBe(WINDOWS_DEFAULT_YAML);
    expect(result.current.activeTab).toBe("yaml");
    expect(result.current.sourceType).toBe("content");
    expect(result.current.error).toBeNull();
  });

  it("syncYamlToJson re-serialises parseable YAML into pretty JSON", () => {
    const { result } = renderHook(() => useNewManifestForm({ importClient: makeImportClient() }));

    act(() => {
      result.current.syncYamlToJson();
    });

    expect(result.current.jsonContent).toContain('"resources"');
    expect(JSON.parse(result.current.jsonContent)).toMatchObject({
      resources: expect.any(Array),
    });
  });

  it("syncYamlToJson keeps existing jsonContent when YAML is unparseable", () => {
    const { result } = renderHook(() => useNewManifestForm({ importClient: makeImportClient() }));

    // First populate jsonContent with a known good value via tab switch
    act(() => {
      result.current.handleTabSwitch("json");
    });
    const populated = result.current.jsonContent;
    expect(populated).not.toBe("");

    // Now break the YAML and try syncing again — jsonContent should not change
    act(() => {
      result.current.setYamlContent("not: : valid: yaml: :");
      result.current.syncYamlToJson();
    });

    expect(result.current.jsonContent).toBe(populated);
  });

  it("switches to the visual tab without creating a second resource buffer", () => {
    const { result } = renderHook(() => useNewManifestForm({ importClient: makeImportClient() }));
    const before = result.current.yamlContent;

    act(() => {
      result.current.handleTabSwitch("visual");
    });

    expect(result.current.activeTab).toBe("visual");
    expect(result.current.yamlContent).toBe(before);
    expect(result.current).not.toHaveProperty("visualResources");
  });

  it("handleJsonChange propagates valid JSON edits back to yamlContent", () => {
    const { result } = renderHook(() => useNewManifestForm({ importClient: makeImportClient() }));

    const customJson = JSON.stringify(
      {
        $schema: "https://aka.ms/osc/schemas/prerelease/document.json",
        resources: [
          {
            name: "Custom",
            type: "Microsoft.Windows/Registry",
            properties: { keyPath: "HKLM:\\Foo" },
          },
        ],
      },
      null,
      2,
    );

    act(() => {
      result.current.handleJsonChange(customJson);
    });

    expect(result.current.jsonContent).toBe(customJson);
    // yamlContent should now reflect the new doc
    const parsed = yaml.load(result.current.yamlContent) as { resources: unknown[] };
    expect(Array.isArray(parsed.resources)).toBe(true);
    expect((parsed.resources[0] as { name: string }).name).toBe("Custom");
  });

  it("handleJsonChange on malformed JSON updates jsonContent but leaves yamlContent unchanged", () => {
    const { result } = renderHook(() => useNewManifestForm({ importClient: makeImportClient() }));
    const original = result.current.yamlContent;

    act(() => {
      result.current.handleJsonChange("{not valid json");
    });

    expect(result.current.jsonContent).toBe("{not valid json");
    expect(result.current.yamlContent).toBe(original);
  });

  it("preserves unsafe QWord integers when editing an unrelated JSON field", () => {
    const { result } = renderHook(() => useNewManifestForm({ importClient: makeImportClient() }));
    const qwordYaml = `resources:
  - name: Original
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM:\\Software\\ConfigForge
      valueName: Exact
      valueType: QWord
      value: 18446744073709551615
`;

    act(() => {
      result.current.setYamlContent(qwordYaml);
    });
    act(() => {
      result.current.handleTabSwitch("json");
    });
    expect(result.current.jsonContent).toContain('"value": 18446744073709551615');

    act(() => {
      result.current.handleJsonChange(
        result.current.jsonContent.replace('"name": "Original"', '"name": "Renamed"'),
      );
    });

    const document = parseVisualManifest(result.current.yamlContent) as {
      resources: Array<{ name: string; properties: { value: bigint } }>;
    };
    expect(document.resources[0].name).toBe("Renamed");
    expect(document.resources[0].properties.value).toBe(18446744073709551615n);
  });

  it("handlePlatformSwitch on default Windows YAML swaps to the Linux default", () => {
    const { result } = renderHook(() => useNewManifestForm({ importClient: makeImportClient() }));

    act(() => {
      result.current.handlePlatformSwitch("linux");
    });

    expect(result.current.platform).toBe("linux");
    expect(result.current.yamlContent).toBe(LINUX_DEFAULT_YAML);
    expect(result.current.platformWarning).toBeNull();
  });

  it("handlePlatformSwitch keeps user content but raises a warning if it contains incompatible types", () => {
    const { result } = renderHook(() => useNewManifestForm({ importClient: makeImportClient() }));

    // Replace YAML with custom Windows-only resource
    const winYaml = yaml.dump({
      $schema: "https://aka.ms/osc/schemas/prerelease/document.json",
      resources: [
        {
          name: "MyReg",
          type: "Microsoft.Windows/Registry",
          properties: { keyPath: "HKLM:\\Foo" },
        },
      ],
    });

    act(() => {
      result.current.setYamlContent(winYaml);
    });

    act(() => {
      result.current.handlePlatformSwitch("linux");
    });

    expect(result.current.platform).toBe("linux");
    expect(result.current.yamlContent).toBe(winYaml); // user content preserved
    expect(result.current.platformWarning).toMatch(/incompatible/);
    expect(result.current.platformWarning).toMatch(/Microsoft\.Windows\/Registry/);
  });

  it("handlePlatformSwitch is a no-op when target platform matches current", () => {
    const { result } = renderHook(() => useNewManifestForm({ importClient: makeImportClient() }));

    act(() => {
      result.current.handlePlatformSwitch("windows");
    });

    expect(result.current.platform).toBe("windows");
    expect(result.current.yamlContent).toBe(WINDOWS_DEFAULT_YAML);
  });

  it("handleImport on success loads result.yaml into the editor and switches to YAML tab", async () => {
    const fromContent = vi.fn().mockResolvedValue({
      type: "manifest",
      filename: "imported.osc.yaml",
      yaml: "resources: []\n",
      data: { resourceCount: 0 },
    });
    const { result } = renderHook(() =>
      useNewManifestForm({ importClient: makeImportClient(fromContent) }),
    );

    const file = new File(["resources: []"], "imported.osc.yaml", { type: "text/yaml" });
    await act(async () => {
      await result.current.handleImport(file);
    });

    expect(fromContent).toHaveBeenCalledWith({
      filename: "imported.osc.yaml",
      content: "resources: []",
    });
    expect(result.current.yamlContent).toBe("resources: []\n");
    expect(result.current.activeTab).toBe("yaml");
    expect(result.current.sourceType).toBe("content");
    expect(result.current.importResult).toMatchObject({
      type: "manifest",
      filename: "imported.osc.yaml",
    });
    expect(result.current.error).toBeNull();
    expect(result.current.importing).toBe(false);
  });

  it("handleImport preserves XLSX files as binary bytes", async () => {
    const fromContent = vi.fn().mockResolvedValue({
      type: "baseline-spreadsheet",
      filename: "baseline.xlsx",
      yaml: "resources: []\n",
      data: { settingCount: 0 },
    });
    const { result } = renderHook(() =>
      useNewManifestForm({ importClient: makeImportClient(fromContent) }),
    );
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "baseline.xlsx");

    await act(async () => {
      await result.current.handleImport(file);
    });

    expect(fromContent).toHaveBeenCalledWith({
      filename: "baseline.xlsx",
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    });
  });

  it("handleImport on failure sets error and leaves yamlContent unchanged", async () => {
    const fromContent = vi.fn().mockRejectedValue(new Error("parse failed"));
    const { result } = renderHook(() =>
      useNewManifestForm({ importClient: makeImportClient(fromContent) }),
    );
    const original = result.current.yamlContent;

    const file = new File(["garbage"], "bad.json", { type: "application/json" });
    await act(async () => {
      await result.current.handleImport(file);
    });

    await waitFor(() => {
      expect(result.current.importing).toBe(false);
    });
    expect(result.current.error).toBe("parse failed");
    expect(result.current.yamlContent).toBe(original);
    expect(result.current.importResult).toBeNull();
  });

  it("clearImport removes a previously selected import", async () => {
    const fromContent = vi.fn().mockResolvedValue({
      type: "manifest",
      filename: "imported.osc.yaml",
      yaml: "resources: []\n",
      data: { resourceCount: 0 },
    });
    const { result } = renderHook(() =>
      useNewManifestForm({ importClient: makeImportClient(fromContent) }),
    );
    await act(async () => {
      await result.current.handleImport(new File(["resources: []"], "imported.osc.yaml"));
    });
    expect(result.current.importResult).not.toBeNull();

    act(() => result.current.clearImport());

    expect(result.current.importResult).toBeNull();
  });

  it("hydrateFromLibraryTemplate loads name/platform/content from sessionStorage and clears the keys", () => {
    sessionStorage.setItem("baseline-template-content", "resources: []\n");
    sessionStorage.setItem("baseline-template-name", "CIS L1 Workstation");
    sessionStorage.setItem("baseline-template-platform", "linux");

    const { result } = renderHook(() => useNewManifestForm({ importClient: makeImportClient() }));

    let hydrated = false;
    act(() => {
      hydrated = result.current.hydrateFromLibraryTemplate();
    });

    expect(hydrated).toBe(true);
    expect(result.current.yamlContent).toBe("resources: []\n");
    expect(result.current.name).toBe("CIS-L1-Workstation"); // sanitised
    expect(result.current.platform).toBe("linux");

    // sessionStorage cleared
    expect(sessionStorage.getItem("baseline-template-content")).toBeNull();
    expect(sessionStorage.getItem("baseline-template-name")).toBeNull();
    expect(sessionStorage.getItem("baseline-template-platform")).toBeNull();
  });

  it("applyTemplate loads an in-page library selection", () => {
    const { result } = renderHook(() => useNewManifestForm({ importClient: makeImportClient() }));

    act(() => {
      result.current.applyTemplate(
        "resources: []\n",
        "Windows Server 2025 - Member Server",
        "windows",
      );
    });

    expect(result.current.yamlContent).toBe("resources: []\n");
    expect(result.current.name).toBe("Windows-Server-2025---Member-Server");
    expect(result.current.platform).toBe("windows");
    expect(result.current.activeTab).toBe("yaml");
  });

  it("hasUserContent returns false on the default scaffold and true after the user types a name", () => {
    const { result } = renderHook(() => useNewManifestForm({ importClient: makeImportClient() }));

    expect(result.current.hasUserContent()).toBe(false);

    act(() => {
      result.current.setName("MyManifest");
    });

    expect(result.current.hasUserContent()).toBe(true);
  });
});
