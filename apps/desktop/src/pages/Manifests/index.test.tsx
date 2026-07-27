// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { OscManifest } from "@configforge/core/types";
import { getI18n } from "../../locales";
import {
  BaselineWorkspaceProvider,
  useBaselineWorkspace,
} from "../../components/BaselineWorkspace";
import { BaselineWorkspaceTabs } from "../../components/BaselineWorkspaceTabs";
import { ManifestsPage } from "./index";

function makeManifest(name: string, overrides: Partial<OscManifest> = {}): OscManifest {
  return {
    Name: name,
    DisplayName: name,
    Source: "oscfg",
    Platform: "windows",
    ResourceCount: 10,
    Resources: [],
    LastModifiedAt: new Date().toISOString(),
    Validation: {
      hasSchema: true,
      hasEnforcementValues: true,
      hasComplianceCriteria: true,
      issues: [],
    },
    Compliance: null,
    ...overrides,
  };
}

function DiffLocationProbe() {
  const location = useLocation();
  return (
    <>
      <output aria-label="diff-path">{location.pathname}</output>
      <output aria-label="diff-state">{JSON.stringify(location.state)}</output>
    </>
  );
}

function WorkspaceCountProbe() {
  return <output aria-label="workspace-count">{useBaselineWorkspace().myBaselineCount}</output>;
}

function renderManifests() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={["/manifests"]}>
        <BaselineWorkspaceProvider>
          <WorkspaceCountProbe />
          <BaselineWorkspaceTabs />
          <Routes>
            <Route path="/manifests" element={<ManifestsPage />} />
            <Route path="/manifests/new" element={<div>New baseline route</div>} />
            <Route path="/manifests/:id" element={<div>Baseline detail route</div>} />
            <Route path="/diff" element={<DiffLocationProbe />} />
          </Routes>
        </BaselineWorkspaceProvider>
      </MemoryRouter>
    </FluentProvider>,
  );
}

async function expectTooltipOnHover(
  user: ReturnType<typeof userEvent.setup>,
  target: Element,
  expectedText: string | RegExp,
) {
  await user.hover(target);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(expectedText);
  await user.unhover(target);
  await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
}

let currentData: OscManifest[];
let listMock: ReturnType<typeof vi.fn>;
let getSourceMock: ReturnType<typeof vi.fn>;
let deleteMock: ReturnType<typeof vi.fn>;
let restoreMock: ReturnType<typeof vi.fn>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function installCfs(data: OscManifest[]) {
  currentData = data;
  listMock = vi.fn().mockImplementation(async () => ({ data: currentData }));
  getSourceMock = vi.fn().mockImplementation(async (name: string) => ({
    data: `resources:\n  - name: ${name}-setting\n    type: Microsoft.Windows/Registry\n`,
  }));
  deleteMock = vi
    .fn()
    .mockImplementation(async (name: string, options?: { requireRecovery?: boolean }) => {
      const manifest = currentData.find((candidate) => candidate.Name === name);
      if (!manifest) throw new Error(`Missing registration for "${name}"`);
      const sourceYaml =
        `resources:\n  - name: ${name}-setting\n` + `    type: Microsoft.Windows/Registry\n`;
      currentData = currentData.filter((candidate) => candidate.Name !== name);
      return {
        message: "deleted",
        data: {
          namespace: name,
          recovery:
            options?.requireRecovery === true
              ? {
                  namespace: name,
                  displayName: manifest.DisplayName || name,
                  sourceYaml,
                  source:
                    manifest.RegistrationSource ??
                    (manifest.Source === "library" ? "library" : "user"),
                  ...(manifest.RegistrationSourceId
                    ? { sourceId: manifest.RegistrationSourceId }
                    : {}),
                }
              : null,
        },
      };
    });
  restoreMock = vi
    .fn()
    .mockImplementation(
      async (request: {
        namespace: string;
        displayName: string;
        source: "user" | "library" | "import";
        sourceId?: string;
      }) => {
        if (currentData.some((manifest) => manifest.Name === request.namespace)) {
          throw new Error(
            `Cannot undo delete for "${request.displayName}" because namespace "${request.namespace}" is already registered. The existing baseline was not changed; Undo remains available.`,
          );
        }
        currentData = [
          ...currentData,
          makeManifest(request.namespace, {
            DisplayName: request.displayName,
            RegistrationSource: request.source,
            RegistrationSourceId: request.sourceId ?? null,
          }),
        ];
        return {
          message: "restored",
          data: { namespace: request.namespace, platform: "windows" },
        };
      },
    );
  Object.assign(window.cfs!, {
    manifests: {
      list: listMock,
      getSource: getSourceMock,
      delete: deleteMock,
      restore: restoreMock,
    },
  });
}

beforeEach(async () => {
  await getI18n().changeLanguage("en");
  localStorage.clear();
  sessionStorage.clear();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  installCfs([
    makeManifest("alpha", {
      DisplayName: "Alpha Security Baseline",
      ResourceCount: 12,
      Compliance: {
        auditedAt: "2026-07-15T10:00:00.000Z",
        total: 12,
        compliant: 12,
        nonCompliant: 0,
        indeterminate: 0,
        errors: 0,
      },
    }),
    makeManifest("linux-beta", {
      Platform: "linux",
      RegistrationSource: "import",
      RegistrationSourceId: "linux-beta.yaml",
      ResourceCount: 20,
      Validation: {
        hasSchema: true,
        hasEnforcementValues: true,
        hasComplianceCriteria: true,
        issues: ["Missing expected value", "Unsupported setting"],
      },
      Compliance: {
        auditedAt: "2026-07-15T10:00:00.000Z",
        total: 20,
        compliant: 14,
        nonCompliant: 5,
        indeterminate: 1,
        errors: 0,
      },
    }),
    makeManifest("unaudited", {
      Platform: "cross-platform",
      ResourceCount: 3,
    }),
  ]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await getI18n().changeLanguage("en");
});

describe("ManifestsPage administrative table", () => {
  it("renders dense table columns and truthful issue/compliance statuses", async () => {
    const user = userEvent.setup();
    renderManifests();

    expect(await screen.findByRole("heading", { name: "My Baselines" })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "My Baselines" });
    for (const column of [
      "Baseline",
      "Operating System",
      "Settings",
      "Issues",
      "Compliant",
      "Date Modified",
    ]) {
      expect(within(table).getByRole("columnheader", { name: column })).toBeInTheDocument();
    }
    expect(table).toHaveClass("border-separate", "border-spacing-0");
    expect(table.parentElement).toHaveClass("isolate", "mt-3");
    expect(table.closest("section")).toHaveClass("pb-3");
    expect(table.closest("section")).not.toHaveClass("pt-3");
    expect(within(table).getByRole("columnheader", { name: "Baseline" })).toHaveClass(
      "sticky",
      "top-0",
      "z-20",
      "bg-slate-100",
      "dark:bg-slate-800",
    );

    const alphaRow = screen.getByRole("row", { name: /Alpha Security Baseline/ });
    expect(alphaRow).toHaveTextContent("Windows");
    expect(alphaRow).toHaveTextContent("12");
    expect(alphaRow).toHaveTextContent("No issues");
    expect(alphaRow).toHaveTextContent("All compliant");
    expect(alphaRow).toHaveTextContent(/\d{4}-\d{2}-\d{2}/);
    expect(within(alphaRow).getByText("No issues")).toHaveClass("bg-slate-100", "text-slate-600");

    const linuxRow = screen.getByRole("row", { name: /linux-beta/ });
    expect(linuxRow).toHaveTextContent("Linux");
    expect(linuxRow).toHaveTextContent("2 issues");
    expect(linuxRow).toHaveTextContent("74% compliant");
    expect(within(linuxRow).getAllByRole("img", { name: "Linux" })).toHaveLength(2);

    const unauditedRow = screen.getByRole("row", { name: /unaudited/ });
    expect(unauditedRow).toHaveTextContent("Not audited");
    const notAudited = within(unauditedRow).getByText("Not audited");
    expect(notAudited).toHaveClass("bg-slate-100", "text-slate-600");
    expect(notAudited).not.toHaveAttribute("title");
    expect(notAudited.closest("td")).not.toHaveAttribute("title");
    expect(notAudited.tagName).toBe("SPAN");
    await expectTooltipOnHover(user, notAudited, "No audit data is available for this baseline");
    expect(within(unauditedRow).getAllByRole("cell")[3]).toHaveClass("text-left");
    expect(within(unauditedRow).getAllByRole("cell")[3]).not.toHaveClass("text-right");
  });

  it("shows Fluent tooltips for platform, validation issues, and modified date cells", async () => {
    const user = userEvent.setup();
    renderManifests();

    const alphaRow = await screen.findByRole("row", { name: /Alpha Security Baseline/ });
    const platformStatus = within(alphaRow).getByText("Windows").parentElement;
    expect(platformStatus).not.toBeNull();
    expect(platformStatus).toHaveAttribute("aria-label", "Windows");
    await expectTooltipOnHover(user, platformStatus as HTMLElement, "Windows");

    const linuxRow = screen.getByRole("row", { name: /linux-beta/ });
    const issuesStatus = within(linuxRow).getByText("2 issues");
    expect(issuesStatus).toHaveAttribute("aria-label", "2 issues");
    const issuesDescriptionId = issuesStatus.getAttribute("aria-describedby");
    expect(issuesDescriptionId).not.toBeNull();
    expect(document.getElementById(issuesDescriptionId as string)).toHaveTextContent(
      /Missing expected value\s+Unsupported setting/,
    );
    await expectTooltipOnHover(user, issuesStatus, /Missing expected value\s+Unsupported setting/);

    const modifiedDate = within(alphaRow).getAllByRole("cell")[6].querySelector("span");
    expect(modifiedDate).not.toBeNull();
    expect(modifiedDate).toHaveAttribute("aria-label", expect.stringMatching(/^Last modified /));
    await expectTooltipOnHover(user, modifiedDate as HTMLElement, /^Last modified /);
  });

  it("sorts columns through ascending, descending, and unsorted states", async () => {
    installCfs([
      makeManifest("charlie", { ResourceCount: 5 }),
      makeManifest("alpha", { ResourceCount: 30 }),
      makeManifest("bravo", { ResourceCount: 20 }),
    ]);
    renderManifests();

    const table = await screen.findByRole("table", { name: "My Baselines" });
    const visibleNames = () =>
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => within(row).getAllByRole("cell")[1].textContent?.trim());

    const baselineHeader = within(table).getByRole("columnheader", { name: "Baseline" });
    const baselineSort = within(baselineHeader).getByRole("button", { name: "Baseline" });
    expect(baselineSort).toHaveClass("hover:bg-[#E4E9F0]");

    fireEvent.click(baselineSort);
    expect(baselineHeader).toHaveAttribute("aria-sort", "ascending");
    expect(visibleNames()).toEqual(["alpha", "bravo", "charlie"]);

    fireEvent.click(baselineSort);
    expect(baselineHeader).toHaveAttribute("aria-sort", "descending");
    expect(visibleNames()).toEqual(["charlie", "bravo", "alpha"]);

    fireEvent.click(baselineSort);
    expect(baselineHeader).not.toHaveAttribute("aria-sort");
    expect(visibleNames()).toEqual(["charlie", "alpha", "bravo"]);

    const settingsHeader = within(table).getByRole("columnheader", { name: "Settings" });
    fireEvent.click(within(settingsHeader).getByRole("button", { name: "Settings" }));
    expect(settingsHeader).toHaveAttribute("aria-sort", "ascending");
    expect(visibleNames()).toEqual(["charlie", "bravo", "alpha"]);
  });

  it("omits a secondary namespace line when it only repeats the display name", async () => {
    installCfs([
      makeManifest("Windows-Secure-Shell--SSH", {
        DisplayName: "Windows Secure Shell (SSH)",
      }),
    ]);
    renderManifests();

    expect(await screen.findByText("Windows Secure Shell (SSH)")).toBeInTheDocument();
    expect(screen.queryByText("Windows-Secure-Shell--SSH")).not.toBeInTheDocument();
  });

  it("uses working filters and select-all only selects filtered rows", async () => {
    renderManifests();
    await screen.findByRole("button", { name: "Open baseline alpha" });

    fireEvent.change(screen.getByRole("combobox", { name: "Operating System" }), {
      target: { value: "linux" },
    });
    expect(screen.queryByRole("button", { name: "Open baseline alpha" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open baseline linux-beta" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all filtered baselines" }));
    expect(screen.getByRole("checkbox", { name: "Select baseline linux-beta" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Open selected baselines" })).toBeEnabled();
  });

  it("enables selection actions and opens every selected baseline tab", async () => {
    renderManifests();
    await screen.findByRole("button", { name: "Open baseline alpha" });

    const undo = screen.getByRole("button", { name: "Undo delete" });
    const deleteAction = screen.getByRole("button", { name: "Delete selected baselines" });
    const diff = screen.getByRole("button", { name: "Diff selected baselines" });
    const open = screen.getByRole("button", { name: "Open selected baselines" });
    expect(undo).toBeDisabled();
    expect(deleteAction).toBeDisabled();
    expect(diff).toBeDisabled();
    expect(open).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select baseline alpha" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select baseline linux-beta" }));
    expect(deleteAction).toBeEnabled();
    expect(diff).toBeEnabled();
    expect(open).toBeEnabled();

    fireEvent.click(open);
    expect(await screen.findByRole("tab", { name: "alpha" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "linux-beta" })).toBeInTheDocument();
  });

  it("uses atomic recovery delete results and restores registration YAML on undo", async () => {
    localStorage.setItem("cfs.baseline-workspace.open-baselines.v1", JSON.stringify(["alpha"]));
    renderManifests();
    await screen.findByRole("button", { name: "Open baseline alpha" });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select baseline alpha" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select baseline linux-beta" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete selected baselines" }));

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringMatching(
        /Undo restores baseline content only.*Deployment, history, rationale, and audit records.*not restored/i,
      ),
    );
    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText("workspace-count")).toHaveTextContent("1"));
    expect(getSourceMock).not.toHaveBeenCalled();
    expect(deleteMock).toHaveBeenCalledWith("alpha", {
      requireRecovery: true,
    });
    expect(deleteMock).toHaveBeenCalledWith("linux-beta", {
      requireRecovery: true,
    });
    expect(screen.queryByRole("tab", { name: "alpha" })).not.toBeInTheDocument();

    const undo = screen.getByRole("button", { name: "Undo delete" });
    expect(undo).toBeEnabled();
    fireEvent.click(undo);

    await waitFor(() => expect(restoreMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText("workspace-count")).toHaveTextContent("3"));
    expect(restoreMock).toHaveBeenCalledWith({
      namespace: "alpha",
      displayName: "Alpha Security Baseline",
      content: "resources:\n  - name: alpha-setting\n    type: Microsoft.Windows/Registry\n",
      source: "user",
    });
    expect(restoreMock).toHaveBeenCalledWith({
      namespace: "linux-beta",
      displayName: "linux-beta",
      content: "resources:\n  - name: linux-beta-setting\n    type: Microsoft.Windows/Registry\n",
      source: "import",
      sourceId: "linux-beta.yaml",
    });
    expect(await screen.findByRole("tab", { name: "alpha" })).toBeInTheDocument();
    expect(
      await screen.findByText(/Deployment, history, rationale, and audit data were not restored/),
    ).toBeInTheDocument();
  });

  it("keeps undo available and preserves a baseline recreated after deletion", async () => {
    renderManifests();
    await screen.findByRole("button", { name: "Open baseline alpha" });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select baseline alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete selected baselines" }));
    await waitFor(() =>
      expect(deleteMock).toHaveBeenCalledWith("alpha", {
        requireRecovery: true,
      }),
    );

    currentData = [...currentData, makeManifest("alpha", { DisplayName: "Replacement Baseline" })];
    fireEvent.click(screen.getByRole("button", { name: "Undo delete" }));

    expect(
      await screen.findByText(/already registered.*not changed.*Undo remains available/i),
    ).toBeInTheDocument();
    expect(currentData.find((manifest) => manifest.Name === "alpha")?.DisplayName).toBe(
      "Replacement Baseline",
    );
    expect(screen.getByRole("button", { name: "Undo delete" })).toBeEnabled();
  });

  it("leaves an unrecoverable baseline untouched when recovery is required", async () => {
    deleteMock.mockImplementationOnce(async () => {
      throw new Error(
        'Manifest "linux-beta" was not deleted because its recovery source YAML is unavailable.',
      );
    });
    renderManifests();
    await screen.findByRole("button", { name: "Open baseline alpha" });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select baseline linux-beta" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete selected baselines" }));

    expect(
      await screen.findByText(
        /No baselines were deleted because recovery content could not be captured/,
      ),
    ).toBeInTheDocument();
    expect(deleteMock).toHaveBeenCalledWith("linux-beta", {
      requireRecovery: true,
    });
    expect(currentData.some((manifest) => manifest.Name === "linux-beta")).toBe(true);
    expect(getSourceMock).not.toHaveBeenCalled();
  });

  it("opens pairwise Diff for two selections and Matrix for three to ten", async () => {
    installCfs([
      makeManifest("baseline-1"),
      makeManifest("baseline-2"),
      makeManifest("baseline-3"),
    ]);
    const first = renderManifests();
    await screen.findByRole("button", { name: "Open baseline baseline-1" });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select baseline baseline-1" }));
    expect(screen.getByRole("button", { name: "Diff selected baselines" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select baseline baseline-2" }));
    fireEvent.click(screen.getByRole("button", { name: "Diff selected baselines" }));

    let state = JSON.parse(screen.getByLabelText("diff-state").textContent ?? "{}");
    expect(state.configForgeDiff).toEqual({
      tab: "pairwise",
      version: 1,
      baselineNames: ["baseline-1", "baseline-2"],
    });

    first.unmount();
    installCfs(Array.from({ length: 11 }, (_, index) => makeManifest(`baseline-${index + 1}`)));
    renderManifests();
    await screen.findByRole("button", { name: "Open baseline baseline-1" });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all filtered baselines" }));
    expect(screen.getByRole("button", { name: "Diff selected baselines" })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select baseline baseline-11" }));
    const diff = screen.getByRole("button", { name: "Diff selected baselines" });
    expect(diff).toBeEnabled();
    fireEvent.click(diff);

    expect(screen.getByLabelText("diff-path")).toHaveTextContent("/diff");
    state = JSON.parse(screen.getByLabelText("diff-state").textContent ?? "{}");
    expect(state.configForgeDiff).toMatchObject({
      tab: "matrix",
      version: 1,
    });
    expect(state.configForgeDiff.baselineNames).toHaveLength(10);
  });

  it("uses the localized baseline-only delete warning in French", async () => {
    const i18n = getI18n();
    await i18n.changeLanguage("fr");

    expect(
      i18n.t("confirm.bulkDeleteBaselineContentOnly", {
        ns: "manifests",
        count: 1,
      }),
    ).toMatch(/déploiement.*historique.*audit.*ne sont pas restaurés/i);
  });

  it("does not crash on malformed legacy LastModifiedAt metadata and shows unavailable", async () => {
    const user = userEvent.setup();
    installCfs([
      makeManifest("legacy", {
        DisplayName: "Legacy Baseline",
        LastModifiedAt: "malformed legacy timestamp",
      }),
    ]);

    renderManifests();

    const open = await screen.findByRole("button", { name: "Open baseline legacy" });
    expect(open).not.toHaveAttribute("title");
    const row = screen.getByRole("row", { name: /Legacy Baseline/ });
    const unavailableDate = within(row).getByText("—");
    expect(unavailableDate.closest("td")).not.toHaveAttribute("title");
    await expectTooltipOnHover(user, unavailableDate, "Last modified date unavailable");
    expect(row).toHaveTextContent("—");
  });

  it("renders Date Modified from the local calendar date instead of the UTC date", async () => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      installCfs([
        makeManifest("local-date", {
          DisplayName: "Local Date Baseline",
          LastModifiedAt: "2026-07-18T00:30:00.000Z",
        }),
      ]);

      renderManifests();

      const row = await screen.findByRole("row", { name: /Local Date Baseline/ });
      expect(within(row).getByText("2026-07-17")).toBeInTheDocument();
    } finally {
      if (previousTimeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimeZone;
      }
    }
  });

  it("blocks Delete, Open, and Diff while Refresh owns the operation gate", async () => {
    renderManifests();
    await screen.findByRole("button", { name: "Open baseline alpha" });
    await waitFor(() => expect(listMock.mock.calls.length).toBeGreaterThanOrEqual(2));

    fireEvent.click(screen.getByRole("checkbox", { name: "Select baseline alpha" }));
    const pendingRefresh = deferred<{ data: OscManifest[] }>();
    listMock.mockImplementationOnce(() => pendingRefresh.promise);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    const deleteAction = screen.getByRole("button", { name: "Delete selected baselines" });
    const openAction = screen.getByRole("button", { name: "Open selected baselines" });
    const diffAction = screen.getByRole("button", { name: "Diff selected baselines" });
    await waitFor(() => expect(deleteAction).toBeDisabled());
    expect(openAction).toBeDisabled();
    expect(diffAction).toBeDisabled();
    expect(screen.getByRole("button", { name: "Open baseline alpha" })).toBeDisabled();

    fireEvent.click(deleteAction);
    expect(deleteMock).not.toHaveBeenCalled();

    await act(async () => {
      pendingRefresh.resolve({ data: currentData });
      await pendingRefresh.promise;
    });
    await waitFor(() => expect(deleteAction).toBeEnabled());
  });
});
