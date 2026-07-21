// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { getI18n } from "../../locales";

const sampleYaml = `resources:
  - name: PasswordPolicy
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM:\\Software\\Example
      valueName: Enabled
      valueType: Dword
      value: 1
`;

const mocks = vi.hoisted(() => ({
  editing: false,
  editView: "editor" as "editor" | "visual",
  activeFormat: "yaml" as "yaml" | "json" | "mof",
  editedContent: "",
  isEditable: true,
  currentDisplayContent: "",
  formatCache: {
    current: {} as Partial<Record<"yaml" | "json" | "mof", string>>,
  },
  error: null as string | null,
  beginEditing: vi.fn(),
  cancelEditing: vi.fn(),
  setError: vi.fn(),
  setEditView: vi.fn(),
  requestSave: vi.fn(),
  closeBaseline: vi.fn(),
  refreshWorkspace: vi.fn().mockResolvedValue([]),
  deleteManifest: vi.fn().mockResolvedValue({ ok: true }),
  exportSave: vi.fn().mockResolvedValue({ ok: true }),
  docsGet: vi.fn().mockResolvedValue({ markdown: "# Sample", filename: "sample.md" }),
  duplicateStatus: vi.fn(),
  deployMenuOpen: false,
  setDeployMenuOpen: vi.fn(),
  handleDeploy: vi.fn(),
  handleRevert: vi.fn(),
  deployNamespace: true,
  deployCapability: true,
  revertNamespace: true,
  revertCapability: true,
}));

vi.mock("../../components/manifest-editor", () => ({
  ManifestEditor: ({
    value,
    readOnly,
    showResourceExplorer,
  }: {
    value: string;
    readOnly?: boolean;
    showResourceExplorer?: boolean;
  }) => (
    <pre
      data-testid="mock-monaco-model"
      data-read-only={String(readOnly)}
      data-resource-explorer={String(showResourceExplorer)}
    >
      {value}
    </pre>
  ),
}));

vi.mock("../../components/BaselineWorkspace", () => ({
  useBaselineWorkspace: () => ({
    closeBaseline: mocks.closeBaseline,
    refresh: mocks.refreshWorkspace,
  }),
}));

vi.mock("../../components/use-cis-available", () => ({
  useCisAvailable: () => false,
}));

vi.mock("../../hooks/useCliPresence", () => ({
  useCliPresence: () => ({ installed: true, loading: false, version: "1.3.9-preview11" }),
}));

vi.mock("../../components/use-rationale-prompt", () => ({
  useRationalePrompt: () => ({
    state: { open: false, busy: false },
    requestSave: mocks.requestSave,
    submitReason: vi.fn(),
    skip: vi.fn(),
    cancel: vi.fn(),
  }),
  RationalePromptModal: () => null,
}));

vi.mock("../../lib/cfs", () => ({
  cfs: {
    manifests: {
      delete: mocks.deleteManifest,
      register: vi.fn().mockResolvedValue({ data: {} }),
      status: mocks.duplicateStatus,
    },
    exportChannel: {
      save: mocks.exportSave,
    },
    docs: {
      get: mocks.docsGet,
    },
  },
  hasCfsNamespace: (key: string) =>
    key === "deploy"
      ? mocks.deployNamespace
      : key === "revert"
        ? mocks.revertNamespace
        : true,
  safeCfs: (key: string) => {
    if (key === "deploy") {
      return mocks.deployNamespace && mocks.deployCapability
        ? { run: vi.fn(), cancel: vi.fn() }
        : mocks.deployNamespace
          ? {}
          : undefined;
    }
    if (key === "revert") {
      return mocks.revertNamespace && mocks.revertCapability
        ? { apply: vi.fn() }
        : mocks.revertNamespace
          ? {}
          : undefined;
    }
    return {};
  },
}));

vi.mock("./state/useManifestEditorState", () => ({
  useManifestEditorState: () => ({
    manifest: {
      Name: "sample",
      DisplayName: "Sample Baseline",
      Source: "Local",
      Platform: "windows",
      Deployed: true,
      Resources: [
        {
          name: "PasswordPolicy",
          type: "Microsoft.Windows/Registry",
          properties: { keyPath: "HKLM:\\Software\\Example", value: 1 },
        },
      ],
    },
    setManifest: vi.fn(),
    status: {
      name: "sample",
      resources: [
        {
          name: "PasswordPolicy",
          type: "Microsoft.Windows/Registry",
          properties: { keyPath: "HKLM:\\Software\\Example", value: 1 },
          compliance: { status: "Compliant", reason: "Matches desired value" },
        },
      ],
    },
    setStatus: vi.fn(),
    loading: false,
    setLoading: vi.fn(),
    error: mocks.error,
    setError: (value: string | null | ((current: string | null) => string | null)) => {
      mocks.error = typeof value === "function" ? value(mocks.error) : value;
      mocks.setError(value);
    },
    manifestNameRef: { current: "sample" },
    fetchData: vi.fn().mockResolvedValue(undefined),
    editing: mocks.editing,
    setEditing: vi.fn(),
    beginEditing: (view?: "editor" | "visual") => {
      mocks.beginEditing(view);
      mocks.editing = true;
      mocks.editView = view ?? "editor";
      if (view === "visual") {
        mocks.activeFormat = "yaml";
        mocks.isEditable = true;
        mocks.currentDisplayContent = mocks.formatCache.current.yaml ?? "";
      }
    },
    cancelEditing: mocks.cancelEditing,
    editedContent: mocks.editedContent,
    setEditedContent: vi.fn(),
    savedContent: sampleYaml,
    setSavedContent: vi.fn(),
    editView: mocks.editView,
    setEditView: mocks.setEditView,
    saving: false,
    setSaving: vi.fn(),
    activeFormat: mocks.activeFormat,
    setActiveFormat: vi.fn(),
    formatLoading: false,
    setFormatLoading: vi.fn(),
    formatCache: mocks.formatCache,
    fetchFormatContent: vi.fn().mockResolvedValue(sampleYaml),
    handleFormatChange: vi.fn().mockResolvedValue(undefined),
    isEditable: mocks.isEditable,
    isReadOnly: !mocks.editing,
    currentDisplayContent: mocks.currentDisplayContent,
    hasUnsavedChanges: false,
  }),
}));

vi.mock("./state/useDeployFlow", () => ({
  useDeployFlow: () => ({
    deploying: false,
    deployProgress: null,
    deployResult: null,
    setDeployResult: vi.fn(),
    deployMenuOpen: mocks.deployMenuOpen,
    setDeployMenuOpen: (open: boolean) => {
      mocks.deployMenuOpen = open;
      mocks.setDeployMenuOpen(open);
    },
    reverting: false,
    cliGateFeature: null,
    setCliGateFeature: vi.fn(),
    deployJobIdRef: { current: null },
    handleDeploy: mocks.handleDeploy,
    handleRevert: mocks.handleRevert,
  }),
}));

import { ManifestDetailPage } from "./index";

function editorShell(initialEntry = "/manifests/sample") {
  return (
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/manifests/:id" element={<ManifestDetailPage />} />
          <Route path="/manifests" element={<div>All baselines route</div>} />
          <Route path="/manifests/new" element={<div>New baseline route</div>} />
        </Routes>
      </MemoryRouter>
    </FluentProvider>
  );
}

function renderEditor() {
  return render(editorShell());
}

describe("ManifestDetailPage Loop viewer", () => {
  beforeEach(async () => {
    await getI18n().changeLanguage("en");
    mocks.editing = false;
    mocks.editView = "editor";
    mocks.activeFormat = "yaml";
    mocks.editedContent = sampleYaml;
    mocks.isEditable = true;
    mocks.currentDisplayContent = sampleYaml;
    mocks.formatCache.current = { yaml: sampleYaml };
    mocks.error = null;
    mocks.deployMenuOpen = false;
    mocks.deployNamespace = true;
    mocks.deployCapability = true;
    mocks.revertNamespace = true;
    mocks.revertCapability = true;
    vi.clearAllMocks();
    mocks.refreshWorkspace.mockResolvedValue([]);
    mocks.deleteManifest.mockResolvedValue({ ok: true });
    mocks.duplicateStatus.mockResolvedValue({ data: sampleYaml });
  });

  afterEach(async () => {
    await getI18n().changeLanguage("en");
    vi.restoreAllMocks();
  });

  it("defaults to read-only Code mode with a Viewing label and sticky detail footer", () => {
    renderEditor();

    expect(screen.getByRole("heading", { name: "Sample Baseline" })).toBeInTheDocument();
    expect(screen.getByTestId("baseline-document-icon")).toHaveClass("bg-white");
    expect(screen.queryByRole("img", { name: "Windows" })).not.toBeInTheDocument();
    expect(screen.getByText("Viewing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Code" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Visual" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("mock-monaco-model")).toHaveAttribute(
      "data-resource-explorer",
      "true",
    );
    expect(screen.getByTestId("mock-monaco-model")).toHaveAttribute("data-read-only", "true");

    const footer = screen.getByTestId("manifest-detail-footer");
    expect(footer).toHaveClass("cfs-manifest-footer", "shrink-0");
    expect(footer.querySelector(".overflow-x-auto")).toBeNull();
    expect(footer.querySelector(".w-max")).toBeNull();
    expect(footer.querySelectorAll(".cfs-footer-secondary-label").length).toBeGreaterThan(0);
    expect(footer.querySelector(".cfs-footer-actions")).toBeInTheDocument();
    expect(footer.querySelector(".cfs-footer-action-group")).toBeInTheDocument();
    expect(within(footer).getByRole("link", { name: "Audit Pack" })).toHaveClass(
      "text-xs",
    );
    for (const action of [
      "Close baseline",
      "Delete Baseline",
      "Duplicate",
      "Audit Pack",
      "Docs",
      "History",
      "Export",
      "Deploy",
      "Revert",
      "Edit",
    ]) {
      expect(
        within(footer).getByRole(
          action === "Audit Pack" || action === "History" ? "link" : "button",
          {
            name: action,
          },
        ),
      ).toBeInTheDocument();
    }

    const footerText = footer.textContent ?? "";
    const orderedActions = [
      "Delete Baseline",
      "Duplicate",
      "Audit Pack",
      "Docs",
      "History",
      "Export",
    ];
    for (let index = 1; index < orderedActions.length; index += 1) {
      expect(footerText.indexOf(orderedActions[index])).toBeGreaterThan(
        footerText.indexOf(orderedActions[index - 1]),
      );
    }
  });

  it("switches between the read-only Code and Visual viewers without selection controls", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole("button", { name: "Visual" }));

    expect(screen.queryByTestId("mock-monaco-model")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Visual baseline settings" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Visual baseline settings" })).getByRole("table"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Code" }));
    expect(screen.getByTestId("mock-monaco-model")).toBeInTheDocument();
  });

  it("keeps Edit available in Visual mode after MOF and opens the YAML spreadsheet", async () => {
    const user = userEvent.setup();
    const mofSource = "instance of Hidden_Mof {}";
    const jsonSource = '{"resources":[]}';
    mocks.activeFormat = "mof";
    mocks.isEditable = false;
    mocks.currentDisplayContent = mofSource;
    mocks.formatCache.current = {
      yaml: sampleYaml,
      json: jsonSource,
      mof: mofSource,
    };
    const { rerender } = renderEditor();

    await user.click(screen.getByRole("button", { name: "Visual" }));

    const editButton = screen.getByRole("button", { name: "Edit" });
    expect(editButton).toBeEnabled();
    expect(
      within(screen.getByRole("region", { name: "Visual baseline settings" })).getByRole("cell", {
        name: "PasswordPolicy",
      }),
    ).toBeInTheDocument();

    await user.click(editButton);
    expect(mocks.beginEditing).toHaveBeenCalledWith("visual");

    rerender(editorShell());
    expect(screen.getByRole("region", { name: "Visual baseline settings" })).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "Spreadsheet editing actions" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add setting" }).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole("button", { name: /Edit Setting Name/ })).toBeInTheDocument();
    expect(mocks.activeFormat).toBe("yaml");
    expect(mocks.formatCache.current).toEqual({
      yaml: sampleYaml,
      json: jsonSource,
      mof: mofSource,
    });
  });

  it("explains when Visual editing is unavailable because canonical YAML is missing", async () => {
    const user = userEvent.setup();
    mocks.activeFormat = "mof";
    mocks.isEditable = false;
    mocks.currentDisplayContent = "instance of Hidden_Mof {}";
    mocks.formatCache.current = { mof: "instance of Hidden_Mof {}" };
    renderEditor();

    await user.click(screen.getByRole("button", { name: "Visual" }));

    expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit" })).toHaveAttribute(
      "title",
      "Editing requires canonical YAML, which is currently unavailable.",
    );
  });

  it("closes the active workspace tab and navigates to All Baselines", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole("button", { name: "Close baseline" }));

    expect(mocks.closeBaseline).toHaveBeenCalledWith("sample");
    expect(screen.getByText("All baselines route")).toBeInTheDocument();
  });

  it("deletes after confirmation, closes the tab, refreshes workspace counts, and navigates", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderEditor();

    await user.click(screen.getByRole("button", { name: "Delete Baseline" }));

    await waitFor(() => {
      expect(mocks.deleteManifest).toHaveBeenCalledWith("sample");
      expect(mocks.closeBaseline).toHaveBeenCalledWith("sample");
      expect(mocks.refreshWorkspace).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("All baselines route")).toBeInTheDocument();
  });

  it("keeps a delete error visible and leaves the active tab open", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.deleteManifest.mockRejectedValueOnce(new Error("Delete was blocked"));
    const { rerender } = renderEditor();

    await user.click(screen.getByRole("button", { name: "Delete Baseline" }));

    await waitFor(() => expect(mocks.setError).toHaveBeenCalledWith("Delete was blocked"));
    rerender(editorShell());
    expect(screen.getByText("Delete was blocked")).toBeInTheDocument();
    expect(mocks.closeBaseline).not.toHaveBeenCalled();
    expect(mocks.refreshWorkspace).not.toHaveBeenCalled();
    expect(screen.queryByText("All baselines route")).not.toBeInTheDocument();
  });

  it("uses the existing editor entry point and keeps compliance rendered", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(mocks.beginEditing).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Compliance Status" })).toBeInTheDocument();
    expect(screen.getAllByText("Matches desired value").length).toBeGreaterThan(0);
  });

  it("keeps export, audit, revert, history, and audit-pack footer actions wired", async () => {
    const user = userEvent.setup();
    const { rerender } = renderEditor();

    expect(screen.getByRole("link", { name: "Audit Pack" })).toHaveAttribute(
      "href",
      "/manifests/sample/audit-pack",
    );
    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute(
      "href",
      "/manifests/sample/history",
    );

    await user.click(screen.getByRole("button", { name: "Export" }));
    for (const format of ["YAML (.osc.yaml)", "JSON (.json)", "MOF (.mof)", "CSV (.csv)"]) {
      expect(screen.getByRole("menuitem", { name: format })).toBeVisible();
    }
    expect(
      screen.queryByRole("menuitem", { name: "Azure Policy (.json)" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "YAML (.osc.yaml)" }));
    expect(mocks.exportSave).toHaveBeenCalledWith({ name: "sample", format: "yaml" });

    await user.click(screen.getByRole("button", { name: "Deploy" }));
    expect(mocks.setDeployMenuOpen).toHaveBeenCalledWith(true);
    mocks.deployMenuOpen = true;
    rerender(editorShell());
    await user.click(screen.getByRole("menuitem", { name: /Audit/ }));
    expect(mocks.handleDeploy).toHaveBeenCalledWith("audit");

    await user.click(screen.getByRole("button", { name: "Revert" }));
    expect(mocks.handleRevert).toHaveBeenCalledTimes(1);
  });

  it("omits Deploy and Revert when their preload namespaces are absent", () => {
    mocks.deployNamespace = false;
    mocks.revertNamespace = false;
    renderEditor();

    const footer = screen.getByTestId("manifest-detail-footer");
    expect(within(footer).queryByRole("button", { name: "Deploy" })).not.toBeInTheDocument();
    expect(within(footer).queryByRole("button", { name: "Revert" })).not.toBeInTheDocument();
    expect(within(footer).getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("omits Deploy and Revert when namespaces exist without callable capabilities", () => {
    mocks.deployCapability = false;
    mocks.revertCapability = false;
    renderEditor();

    const footer = screen.getByTestId("manifest-detail-footer");
    expect(within(footer).queryByRole("button", { name: "Deploy" })).not.toBeInTheDocument();
    expect(within(footer).queryByRole("button", { name: "Revert" })).not.toBeInTheDocument();
  });

  it("keeps Cancel in the header and toggles the anchored footer action to Save", async () => {
    const user = userEvent.setup();
    mocks.editing = true;
    mocks.editView = "editor";
    renderEditor();

    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Code" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Visual" })).toBeInTheDocument();
    expect(screen.getByTestId("mock-monaco-model")).toHaveAttribute("data-read-only", "false");
    const footer = screen.getByTestId("manifest-detail-footer");
    expect(within(footer).getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(within(footer).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.getByText("Editing")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Compliance Status" })).toBeInTheDocument();

    await user.click(within(footer).getByRole("button", { name: "Save" }));
    expect(mocks.requestSave).toHaveBeenCalledWith(sampleYaml, sampleYaml);
  });

  it("blocks Save while a spreadsheet cell contains an invalid typed draft", async () => {
    const user = userEvent.setup();
    mocks.editing = true;
    mocks.editView = "visual";
    renderEditor();

    await user.click(
      screen.getByRole("button", { name: "Edit Applied value for PasswordPolicy" }),
    );
    const editor = screen.getByRole("textbox", {
      name: "Edit Applied value for PasswordPolicy",
    });
    await user.clear(editor);
    await user.type(editor, "not-a-number");

    const save = within(screen.getByTestId("manifest-detail-footer")).getByRole("button", {
      name: "Save",
    });
    await waitFor(() => expect(save).toBeDisabled());
    expect(save).toHaveAttribute(
      "title",
      "Complete or correct the highlighted cells before saving.",
    );
    await user.click(save);
    expect(mocks.requestSave).not.toHaveBeenCalled();
  });

  it("blocks Save for incomplete rows added to the spreadsheet", () => {
    mocks.editing = true;
    mocks.editView = "visual";
    mocks.editedContent = `resources:
  - name: ""
    type: Microsoft.Windows/Registry
    properties:
      keyPath: ""
      valueName: ""
      valueType: String
      value: ""
`;
    renderEditor();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Complete 3 required cells before saving.",
    );
    expect(
      within(screen.getByTestId("manifest-detail-footer")).getByRole("button", {
        name: "Save",
      }),
    ).toBeDisabled();
  });

  it("uses the grouped spreadsheet as the visual edit experience", () => {
    mocks.editing = true;
    mocks.editView = "visual";
    renderEditor();

    expect(screen.getByRole("region", { name: "Visual baseline settings" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add setting" }).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole("button", { name: /Edit Setting Name/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Code" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Visual" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("ManifestDetailPage localization", () => {
  beforeEach(async () => {
    await getI18n().changeLanguage("en");
    mocks.editing = false;
    mocks.editView = "editor";
    mocks.activeFormat = "yaml";
    mocks.editedContent = sampleYaml;
    mocks.isEditable = true;
    mocks.currentDisplayContent = sampleYaml;
    mocks.formatCache.current = { yaml: sampleYaml };
    mocks.error = null;
    mocks.deployMenuOpen = false;
    mocks.deployNamespace = true;
    mocks.deployCapability = true;
    mocks.revertNamespace = true;
    mocks.revertCapability = true;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await getI18n().changeLanguage("en");
    vi.restoreAllMocks();
  });

  it("renders the viewer chrome after a language switch without crashing", async () => {
    const i18n = getI18n();
    const { rerender } = renderEditor();

    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deploy" })).toBeInTheDocument();

    await i18n.changeLanguage("fr");
    rerender(editorShell());

    expect(screen.getByRole("button", { name: "Modifier" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Déployer" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Baseline Contenu" })).toBeInTheDocument();
  });

  it("keeps the Monaco model content stable while app chrome re-renders on language switch", async () => {
    const i18n = getI18n();
    const { rerender } = renderEditor();

    expect(screen.getByTestId("mock-monaco-model")).toHaveTextContent("PasswordPolicy");
    expect(screen.getByRole("tab", { name: "YAML" })).toBeInTheDocument();

    await i18n.changeLanguage("fr");
    rerender(editorShell());

    expect(screen.getByTestId("mock-monaco-model")).toHaveTextContent("PasswordPolicy");
    expect(screen.getByRole("tab", { name: "YAML" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "JSON" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "MOF" })).toBeInTheDocument();
  });
});
