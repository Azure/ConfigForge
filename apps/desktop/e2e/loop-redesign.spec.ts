// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const APP_ROOT = path.resolve(__dirname, "..");
const MAIN_ENTRY = path.join(APP_ROOT, "dist", "electron", "main.js");
const requireFromApp = createRequire(path.join(APP_ROOT, "package.json"));
const electronExecutablePath = requireFromApp("electron") as string;

const BASELINE_A = "LoopWindowsA";
const BASELINE_B = "LoopWindowsB";
const BASELINE_LINUX = "LoopLinux";
const BASELINE_BLANK = "Blankmanifest";
const BASELINE_WINDOWS_COLLISION = "Windows-Server-Search-Collision";
const ALL_NAMES = [
  BASELINE_A,
  BASELINE_B,
  BASELINE_LINUX,
  BASELINE_BLANK,
  BASELINE_WINDOWS_COLLISION,
];

const WINDOWS_A_YAML = `resources:
  - name: AlphaSetting
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKEY_LOCAL_MACHINE\\SOFTWARE\\ConfigForge\\Loop
      valueName: Alpha
      valueType: Dword
      value: 1
  - name: BetaSetting
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKEY_LOCAL_MACHINE\\SOFTWARE\\ConfigForge\\Loop
      valueName: Beta
      valueType: String
      value: Enabled
`;

const WINDOWS_B_YAML = `resources:
  - name: GammaSetting
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKEY_LOCAL_MACHINE\\SOFTWARE\\ConfigForge\\Loop
      valueName: Gamma
      valueType: Dword
      value: 0
`;

const LINUX_YAML = `resources:
  - name: SecureConfigFile
    type: Linux/FilePermission
    properties:
      path: /etc/configforge-loop.conf
      mode: "0644"
`;

const SEARCH_COLLISION_YAML = `resources:
  - name: AccountsLimitLocalAccountUseOfBlankPasswordsToConsoleLogonOnly
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Lsa
      valueName: LimitBlankPasswordUse
      valueType: Dword
      value: 1
`;

let app: ElectronApplication;
let page: Page;
let configHome: string;
let browserProfile: string;
let publicRoot: string;

async function launchApp(): Promise<void> {
  app = await _electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${browserProfile}`],
    cwd: APP_ROOT,
    executablePath: electronExecutablePath,
    env: {
      ...process.env,
      CONFIGFORGE_HOME: configHome,
      CONFIGFORGE_PUBLIC_ROOT: publicRoot,
      CONFIGFORGE_TEST_MODE: "1",
      NODE_ENV: "production",
      LC_ALL: "en_US.UTF-8",
      LANG: "en_US.UTF-8",
    },
  });
  page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1440, height: 1000 });
}

async function registerBaseline(name: string, content: string): Promise<void> {
  await page.evaluate(
    async ({ baselineName, yaml }) => {
      await window.cfs!.manifests.register({
        name: baselineName,
        content: yaml,
      });
    },
    { baselineName: name, yaml: content },
  );
}

async function goToMyBaselines(): Promise<void> {
  await page.locator("aside").getByRole("link", { name: /My Baselines/ }).click();
  await expect(page.getByRole("heading", { name: "My Baselines" })).toBeVisible();
}

test.describe.serial("Loop redesign end-to-end flow", () => {
  test.beforeAll(async () => {
    configHome = await mkdtemp(path.join(os.tmpdir(), "configforge-loop-home-"));
    browserProfile = await mkdtemp(path.join(os.tmpdir(), "configforge-loop-profile-"));
    publicRoot = await mkdtemp(path.join(os.tmpdir(), "configforge-loop-public-"));
    await launchApp();
    await page.evaluate(() => {
      localStorage.setItem("cfs.welcome.dismissedAt", new Date().toISOString());
    });
    await registerBaseline(BASELINE_A, WINDOWS_A_YAML);
    await registerBaseline(BASELINE_B, WINDOWS_B_YAML);
    await registerBaseline(BASELINE_LINUX, LINUX_YAML);
    await registerBaseline(BASELINE_BLANK, SEARCH_COLLISION_YAML);
    await registerBaseline(BASELINE_WINDOWS_COLLISION, SEARCH_COLLISION_YAML);
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    try {
      await app.close();
    } catch {
      // App may already be closed by the persistence test.
    }
    await Promise.all([
      rm(configHome, { recursive: true, force: true }),
      rm(browserProfile, { recursive: true, force: true }),
      rm(publicRoot, { recursive: true, force: true }),
    ]);
  });

  test("navigation counts and My Baselines table reflect authoritative data", async () => {
    await expect(
      page.locator("aside").getByRole("link", { name: `My Baselines (${ALL_NAMES.length})` }),
    ).toBeVisible();
    await expect(
      page.locator("aside").getByRole("link", { name: /Microsoft Baselines \(\d+\)/ }),
    ).toBeVisible();

    await goToMyBaselines();

    const table = page.getByRole("table", { name: "My Baselines" });
    await expect(table).toBeVisible();
    for (const heading of [
      "Baseline",
      "Operating System",
      "Settings",
      "Issues",
      "Compliant",
      "Date Modified",
    ]) {
      await expect(
        table.getByRole("columnheader", { name: heading, exact: true }),
      ).toBeVisible();
    }
    await expect(page.getByRole("textbox", { name: "Search Baselines" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Operating System" })).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(BASELINE_A) })).toContainText(
      /\d{4}-\d{2}-\d{2}/,
    );

    await page.getByRole("combobox", { name: "Operating System" }).selectOption("linux");
    await expect(page.getByRole("button", { name: `Open baseline ${BASELINE_LINUX}` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Open baseline ${BASELINE_A}` })).toHaveCount(0);
    await page.getByRole("combobox", { name: "Operating System" }).selectOption("all");
  });

  test("selection actions open workspace tabs and preselect Pairwise Diff for two", async () => {
    await page.getByRole("checkbox", { name: `Select baseline ${BASELINE_A}` }).check();
    await page.getByRole("checkbox", { name: `Select baseline ${BASELINE_B}` }).check();
    await expect(page.getByRole("button", { name: "Open selected baselines" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Diff selected baselines" })).toBeEnabled();

    await page.getByRole("button", { name: "Open selected baselines" }).click();
    const tablist = page.getByRole("tablist", { name: "Open baselines" });
    const baselineATab = tablist.getByRole("tab", { name: BASELINE_A });
    await expect(baselineATab).toBeVisible();
    await expect(baselineATab.locator('[data-platform="windows"]')).toBeVisible();
    await expect(tablist.getByRole("tab", { name: BASELINE_B })).toBeVisible();

    await page.getByRole("button", { name: "Diff selected baselines" }).click();
    await expect(page.getByRole("tab", { name: "Pairwise" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const pairwiseSelects = page
      .locator("select")
      .filter({ has: page.locator(`option[value="${BASELINE_A}"]`) });
    await expect(pairwiseSelects).toHaveCount(2);
    await expect(pairwiseSelects.nth(0)).toHaveValue(BASELINE_A);
    await expect(pairwiseSelects.nth(1)).toHaveValue(BASELINE_B);

    await page.getByRole("tab", { name: "Matrix (N-way)" }).click();
    const matrixPicker = page
      .getByRole("heading", { name: "Pick 2–10 baselines to compare" })
      .locator("..");
    const baselineSearch = matrixPicker.getByRole("searchbox", { name: /Search Baselines/i });
    await baselineSearch.fill(BASELINE_LINUX);
    await expect(matrixPicker.getByText(BASELINE_LINUX, { exact: true })).toBeVisible();
    await expect(matrixPicker.getByText(BASELINE_A, { exact: true })).toHaveCount(0);
  });

  test("search filters baseline identity without hidden resource collisions", async () => {
    await goToMyBaselines();
    const search = page.getByRole("textbox", { name: "Search Baselines" });

    await search.fill("Blank");
    await expect(page.getByRole("button", { name: `Open baseline ${BASELINE_BLANK}` })).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Open baseline ${BASELINE_WINDOWS_COLLISION}` }),
    ).toHaveCount(0);
    await expect(page.getByText("Showing 1 of 5")).toBeVisible();

    await search.fill("windows");
    await expect(
      page.getByRole("button", { name: `Open baseline ${BASELINE_WINDOWS_COLLISION}` }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Open baseline ${BASELINE_BLANK}` }),
    ).toHaveCount(0);

    await search.fill("");
    await expect(page.getByText("Showing 5 of 5")).toBeVisible();
  });

  test("Code and Visual viewers preserve read-only and edit flows", async () => {
    await goToMyBaselines();
    await page.getByRole("button", { name: `Open baseline ${BASELINE_A}` }).click();

    await expect(page.getByTestId("baseline-document-icon")).toBeVisible();
    await expect(page.getByText("Viewing", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Read-only view. Select Edit in the footer to make changes."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Code" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const codeEditor = page.locator(".monaco-editor").first();
    await codeEditor.click();
    await page.keyboard.type("x");
    const readOnlyMessage = page.locator(
      ".monaco-overflow-host .monaco-editor-overlaymessage .message",
    );
    await expect(readOnlyMessage).toBeVisible();
    expect(
      await readOnlyMessage.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          backgroundColor: style.backgroundColor,
          borderColor: style.borderColor,
          color: style.color,
          opacity: style.opacity,
        };
      }),
    ).toEqual({
      backgroundColor: "rgb(37, 37, 38)",
      borderColor: "rgb(0, 122, 204)",
      color: "rgb(204, 204, 204)",
      opacity: "1",
    });
    for (const format of ["YAML", "JSON", "MOF"]) {
      await expect(page.getByRole("tab", { name: format })).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "Compliance Status" })).toBeVisible();
    const footer = page.getByTestId("manifest-detail-footer");
    await expect(footer).toBeVisible();
    const readFooterGeometry = () =>
      footer.evaluate((element) => {
        const footerRect = element.getBoundingClientRect();
        const controls = Array.from(element.querySelectorAll<HTMLElement>("button, a"))
          .filter((control) => {
            const style = getComputedStyle(control);
            return style.display !== "none" && style.visibility !== "hidden";
          })
          .map((control) => {
            const rect = control.getBoundingClientRect();
            return {
              label: control.getAttribute("aria-label") ?? control.textContent?.trim() ?? "",
              bottom: rect.bottom,
              centerY: (rect.top + rect.bottom) / 2,
              left: rect.left,
              right: rect.right,
              top: rect.top,
            };
          });
        const overlaps = controls.flatMap((control, index) =>
          controls.slice(index + 1).flatMap((candidate) => {
            const horizontalOverlap =
              Math.min(control.right, candidate.right) - Math.max(control.left, candidate.left);
            const verticalOverlap =
              Math.min(control.bottom, candidate.bottom) - Math.max(control.top, candidate.top);
            return horizontalOverlap > 1 && verticalOverlap > 1
              ? [`${control.label} overlaps ${candidate.label}`]
              : [];
          }),
        );
        const labels = Array.from(
          element.querySelectorAll<HTMLElement>(
            ".cfs-footer-close-label, .cfs-footer-secondary-label, .cfs-footer-primary-label",
          ),
        ).map((label) => ({
          display: getComputedStyle(label).display,
          text: label.textContent?.trim() ?? "",
        }));
        return {
          clientWidth: element.clientWidth,
          controls,
          height: footerRect.height,
          labels,
          left: footerRect.left,
          overlaps,
          right: footerRect.right,
          scrollWidth: element.scrollWidth,
        };
      });
    for (const width of [2000, 1800, 1760, 1600, 1440, 1280, 1100, 940, 880]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await readFooterGeometry();
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
      expect(geometry.height).toBeLessThanOrEqual(128);
      expect(geometry.overlaps, `footer control collisions at ${width}px`).toEqual([]);
      expect(geometry.labels.length).toBe(geometry.controls.length);
      for (const label of geometry.labels) {
        expect(label.display, `${label.text} label display at ${width}px`).not.toBe("none");
        expect(label.text, `label text at ${width}px`).not.toBe("");
      }
      for (const control of geometry.controls) {
        expect(control.left, `${control.label} left edge at ${width}px`).toBeGreaterThanOrEqual(
          geometry.left,
        );
        expect(control.right, `${control.label} right edge at ${width}px`).toBeLessThanOrEqual(
          geometry.right,
        );
      }
      const rows = new Set(geometry.controls.map((control) => Math.round(control.centerY)));
      if (geometry.clientWidth <= 1760) {
        expect(rows.size, `responsive rows at ${width}px`).toBeGreaterThan(1);
      } else {
        expect(rows.size, `single footer row at ${width}px`).toBe(1);
      }
      if (geometry.clientWidth <= 940) {
        const secondaryRows = new Map<number, number>();
        for (const control of geometry.controls.filter(
          (control) => control.label !== "Close baseline" && control.label !== "Edit",
        )) {
          const row = Math.round(control.centerY);
          secondaryRows.set(row, (secondaryRows.get(row) ?? 0) + 1);
        }
        const counts = [...secondaryRows.values()];
        expect(counts).toHaveLength(2);
      }
      for (const action of [
        "Close baseline",
        "Delete Baseline",
        "Undo",
        "Duplicate",
        "Audit Pack",
        "Docs",
        "History",
        "Export",
        "Edit",
      ]) {
        await expect(
          footer.getByRole(action === "Audit Pack" || action === "History" ? "link" : "button", {
            name: action,
          }),
        ).toBeVisible();
      }
    }

    await page.getByRole("button", { name: "Visual" }).click();
    const visual = page.getByRole("region", { name: "Visual baseline settings" });
    await expect(visual).toBeVisible();
    await expect(visual.getByRole("table", { name: /Registry settings/i })).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await visual.getByRole("cell", { name: "AlphaSetting" }).click();
    await expect(page.getByTestId("visual-readonly-tooltip")).toHaveText(
      "Cannot edit in view-only mode",
    );
    await page.mouse.move(16, 16);
    await expect(page.getByTestId("visual-readonly-tooltip")).toHaveCount(0);

    const settingName = visual.getByRole("button", { name: "Setting Name" }).first();
    await settingName.click();
    await expect(settingName.locator("xpath=..")).toHaveAttribute("aria-sort", "ascending");
    await settingName.click();
    await expect(settingName.locator("xpath=..")).toHaveAttribute("aria-sort", "descending");
    await settingName.click();
    await expect(settingName.locator("xpath=..")).not.toHaveAttribute("aria-sort");

    const registryScrollArea = visual.getByTestId("visual-table-scroll").first();
    await page.setViewportSize({ width: 900, height: 900 });
    await expect(registryScrollArea).toBeVisible();
    const narrowLayout = await registryScrollArea.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      const container = element.getBoundingClientRect();
      const row = element.querySelector("tbody tr");
      const cells = row ? Array.from(row.querySelectorAll("td")) : [];
      const visibleRects = cells
        .map((cell) => {
          const rect = cell.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        })
        .filter((rect) => rect.right > container.left && rect.left < container.right)
        .sort((left, right) => left.left - right.left);
      const overlaps = visibleRects.some(
        (rect, index) =>
          index > 0 && visibleRects[index - 1].right > rect.left + 1,
      );
      const stickyCells = cells.filter(
        (cell) => getComputedStyle(cell).position === "sticky",
      ).length;
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        overlaps,
        stickyCells,
      };
    });
    expect(narrowLayout.scrollWidth).toBeGreaterThan(narrowLayout.clientWidth);
    expect(narrowLayout.stickyCells).toBe(0);
    expect(narrowLayout.overlaps).toBe(false);
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.getByRole("button", { name: "Edit" }).click();
    await expect(footer.getByRole("button", { name: "Save" })).toBeVisible();
    await expect(footer.getByRole("button", { name: "Edit" })).toHaveCount(0);
    const editFooterGeometry = await readFooterGeometry();
    expect(editFooterGeometry.overlaps, "footer control collisions while editing").toEqual([]);
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();
    await expect(visual.getByRole("checkbox")).toHaveCount(3);
    const firstSelection = visual.getByRole("checkbox").first();
    const unselectAll = visual.getByRole("button", { name: "Unselect All" });
    await expect(unselectAll).toBeDisabled();
    await firstSelection.check();
    await expect(unselectAll).toBeEnabled();
    await unselectAll.click();
    await expect(firstSelection).not.toBeChecked();
    const registrySection = visual
      .getByRole("heading", { name: "Registry" })
      .locator("xpath=../..");
    await expect(registrySection.getByRole("button", { name: "Add setting" })).toHaveCount(2);

    await visual
      .getByRole("button", { name: "Edit Applied value for AlphaSetting" })
      .click();
    const valueEditor = visual.getByRole("textbox", {
      name: "Edit Applied value for AlphaSetting",
    });
    await valueEditor.fill("5");
    await page.getByRole("button", { name: "Close baseline" }).click();
    const closeDialog = page.getByRole("dialog", {
      name: "Close without saving?",
    });
    await expect(closeDialog).toBeVisible();
    await closeDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();
    // Save directly while the cell still has focus. Blur must commit the
    // valid draft before the footer's Save handler reads editedContent.
    await footer.getByRole("button", { name: "Save" }).click();
    const rationale = page.getByRole("dialog", { name: "Why this change?" });
    await expect(rationale).toBeVisible();
    await rationale.getByRole("button", { name: "Skip" }).click();
    await expect(page.getByText("Viewing", { exact: true })).toBeVisible();
    await expect(visual.getByRole("checkbox")).toHaveCount(0);

    const saved = await page.evaluate(async (name) => {
      return window.cfs!.manifests.getSource(name);
    }, BASELINE_A);
    expect(saved.data).toContain("value: 5");

    await page.getByRole("button", { name: "Close baseline" }).click();
    await expect(page.getByRole("heading", { name: "My Baselines" })).toBeVisible();
    await expect(
      page.getByRole("tablist", { name: "Open baselines" }).getByRole("tab", {
        name: BASELINE_A,
      }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: `Open baseline ${BASELINE_A}` }).click();
    await expect(page.getByRole("button", { name: "Visual" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("long multi-value rows stay inside their cells in view and edit modes", async () => {
    const baselineName = "LoopMultiValue";
    const settingName = "CryptographySSLCipherSuites";
    const longValue = "TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384";
    const source = `resources:
  - name: ${settingName}
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\\Cryptography\\Configuration\\SSL\\00010002
      valueName: Functions
      valueType: MultiString
      value:
        - ${longValue}
        - TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA384
`;

    const assertContainedByCell = async (locator: ReturnType<typeof page.getByText>) => {
      const geometry = await locator.evaluate((element) => {
        const cell = element.closest("td");
        if (!cell) throw new Error("Multi-value item is not inside a table cell");
        const itemRect = element.getBoundingClientRect();
        const cellRect = cell.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          cellLeft: cellRect.left,
          cellRight: cellRect.right,
          itemLeft: itemRect.left,
          itemRight: itemRect.right,
          overflowWrap: style.overflowWrap,
          whiteSpace: style.whiteSpace,
        };
      });
      expect(geometry.itemLeft).toBeGreaterThanOrEqual(geometry.cellLeft);
      expect(geometry.itemRight).toBeLessThanOrEqual(geometry.cellRight + 1);
      expect(geometry.overflowWrap).toBe("anywhere");
      expect(geometry.whiteSpace).toBe("pre-wrap");
    };

    try {
      await registerBaseline(baselineName, source);
      await page.reload();
      await page.waitForLoadState("domcontentloaded");
      await goToMyBaselines();
      await page.getByRole("button", { name: `Open baseline ${baselineName}` }).click();
      await page.getByRole("button", { name: "Visual" }).click();
      const visual = page.getByRole("region", { name: "Visual baseline settings" });
      const viewItems = visual.getByText(longValue, { exact: true });
      await expect(viewItems).toHaveCount(2);
      for (let index = 0; index < 2; index += 1) {
        const viewItem = viewItems.nth(index);
        await expect(viewItem).toBeVisible();
        await assertContainedByCell(viewItem);
      }

      await page.getByRole("button", { name: "Edit" }).click();
      await expect(page.getByTestId("manifest-detail-footer").getByRole("button", { name: "Save" }))
        .toBeVisible();
      const editItem = visual
        .getByRole("button", {
          name: `Edit Applied value value 1 for ${settingName}`,
        })
        .getByText(longValue, { exact: true });
      await expect(editItem).toBeVisible();
      await assertContainedByCell(editItem);

      await page.getByRole("button", { name: "Cancel" }).click();
      await page.getByRole("button", { name: "Close baseline" }).click();
      await expect(page.getByRole("heading", { name: "My Baselines" })).toBeVisible();
    } finally {
      await page.evaluate(async (name) => {
        try {
          await window.cfs!.manifests.delete(name);
        } catch {
          // Cleanup should not hide the layout assertion.
        }
      }, baselineName);
      await page.reload();
      await page.waitForLoadState("domcontentloaded");
    }
  });

  test("Delete and session Undo restore captured baseline content", async () => {
    await page.getByRole("checkbox", { name: `Select baseline ${BASELINE_B}` }).check();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete selected baselines" }).click();
    await expect(page.getByRole("button", { name: `Open baseline ${BASELINE_B}` })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Undo delete" })).toBeEnabled();

    await page.getByRole("button", { name: "Undo delete" }).click();
    await expect(page.getByRole("button", { name: `Open baseline ${BASELINE_B}` })).toBeVisible();
    const restored = await page.evaluate(async (name) => {
      return window.cfs!.manifests.getSource(name);
    }, BASELINE_B);
    expect(restored.data).toContain("GammaSetting");
  });

  test("Benchmark Mapping transitions in place from unloaded to usable CIS data", async () => {
    await page.locator("aside").getByRole("link", { name: "Benchmark Mapping" }).click();
    await expect(page.getByRole("heading", { name: "Benchmark Mapping" })).toBeVisible();
    const steps = page
      .getByRole("list", { name: "CIS catalog setup" })
      .getByRole("heading", { level: 2 });
    await expect(steps).toHaveText([
      /Download CIS baselines/,
      /Import the CIS baseline files/,
      /Re-check catalog/,
    ]);
    await expect(page.getByText("No CIS data found")).toBeVisible();

    const dataDir = await page.evaluate(async () => {
      const status = await window.cfs!.cis.status();
      return status.dataDir;
    });
    if (!dataDir) throw new Error("CIS data directory was not reported");
    expect(path.resolve(dataDir)).toBe(path.join(publicRoot, "_baselines", "cis", "_data"));
    await mkdir(dataDir, { recursive: true });
    const cisFixturePath = path.join(dataDir, "loop-e2e-cis.json");
    await writeFile(
      cisFixturePath,
      JSON.stringify({
        standard: "CIS",
        baselineSettings: [
          {
            name: "CIS Windows Server Loop E2E Benchmark",
            version: "1.0.0",
            settings: [
              {
                ruleId: "1.1",
                name: "1.1 Ensure Loop E2E setting is configured;DesiredObjectValue",
                value: "1",
              },
            ],
          },
        ],
      }),
      "utf8",
    );
    const xccdfPrefix =
      "CIS_Azure_Compute_Microsoft_Windows_Server_2022_Benchmark_v1.0.0";
    await Promise.all([
      writeFile(
        path.join(dataDir, `${xccdfPrefix}-xccdf.xml`),
        "<Benchmark><title>CIS Azure Compute Microsoft Windows Server 2022 Benchmark</title></Benchmark>",
        "utf8",
      ),
      writeFile(
        path.join(dataDir, `${xccdfPrefix}-oval.xml`),
        "<oval_definitions />",
        "utf8",
      ),
      writeFile(
        path.join(dataDir, `${xccdfPrefix}-cpe-oval.xml`),
        "<oval_definitions />",
        "utf8",
      ),
    ]);

    await page.getByRole("button", { name: "Re-check catalog" }).click();
    await expect(page.getByText("CIS data found")).toBeVisible();
    const detected = page.getByRole("region", { name: "Detected CIS catalogs" });
    await expect(detected).toContainText("CIS Windows Server Loop E2E Benchmark");
    await expect(detected).toContainText(
      "CIS Azure Compute Microsoft Windows Server 2022 Benchmark",
    );
    await expect(detected).toContainText("OVAL companion found");
    await expect(detected).toContainText("1 rule");
    await expect(page.getByText("Unrecognized files")).toHaveCount(0);
    await expect(page.getByText(`${xccdfPrefix}-cpe-oval.xml`)).toHaveCount(0);
    await expect(steps).toHaveText([
      /Download CIS baselines/,
      /Import the CIS baseline files/,
      /Re-check catalog/,
    ]);
  });

  test("open baseline tabs survive an application restart", async () => {
    await goToMyBaselines();
    await page.getByRole("button", { name: `Open baseline ${BASELINE_LINUX}` }).click();
    await expect(
      page.getByRole("tablist", { name: "Open baselines" }).getByRole("tab", {
        name: BASELINE_LINUX,
      }),
    ).toBeVisible();

    await app.close();
    await launchApp();
    await goToMyBaselines();

    await expect(
      page.getByRole("tablist", { name: "Open baselines" }).getByRole("tab", {
        name: BASELINE_LINUX,
      }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("tablist", { name: "Open baselines" })
        .getByRole("tab", { name: BASELINE_LINUX })
        .locator('[data-platform="linux"]'),
    ).toBeVisible();
  });
});
