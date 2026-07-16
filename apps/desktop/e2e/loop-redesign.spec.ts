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
const ALL_NAMES = [BASELINE_A, BASELINE_B, BASELINE_LINUX];

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
    ]) {
      await expect(
        table.getByRole("columnheader", { name: heading, exact: true }),
      ).toBeVisible();
    }
    await expect(page.getByRole("textbox", { name: "Search Baselines" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Operating System" })).toBeVisible();

    await page.getByRole("combobox", { name: "Operating System" }).selectOption("linux");
    await expect(page.getByRole("button", { name: `Open baseline ${BASELINE_LINUX}` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Open baseline ${BASELINE_A}` })).toHaveCount(0);
    await page.getByRole("combobox", { name: "Operating System" }).selectOption("all");
  });

  test("selection actions open workspace tabs and preselect Matrix Diff", async () => {
    await page.getByRole("checkbox", { name: `Select baseline ${BASELINE_A}` }).check();
    await page.getByRole("checkbox", { name: `Select baseline ${BASELINE_B}` }).check();
    await expect(page.getByRole("button", { name: "Open selected baselines" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Diff selected baselines" })).toBeEnabled();

    await page.getByRole("button", { name: "Open selected baselines" }).click();
    const tablist = page.getByRole("tablist", { name: "Open baselines" });
    await expect(tablist.getByRole("tab", { name: BASELINE_A })).toBeVisible();
    await expect(tablist.getByRole("tab", { name: BASELINE_B })).toBeVisible();

    await page.getByRole("button", { name: "Diff selected baselines" }).click();
    await expect(page.getByRole("tab", { name: "Matrix (N-way)" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("checkbox", { name: BASELINE_A })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: BASELINE_B })).toBeChecked();
  });

  test("Code and Visual viewers preserve read-only and edit flows", async () => {
    await goToMyBaselines();
    await page.getByRole("button", { name: `Open baseline ${BASELINE_A}` }).click();

    await expect(page.getByText("Viewing", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Code" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const format of ["YAML", "JSON", "MOF"]) {
      await expect(page.getByRole("tab", { name: format })).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "Compliance Status" })).toBeVisible();
    await expect(page.getByTestId("manifest-detail-footer")).toBeVisible();

    await page.getByRole("button", { name: "Visual" }).click();
    const visual = page.getByRole("region", { name: "Visual baseline settings" });
    await expect(visual).toBeVisible();
    await expect(visual.getByRole("table", { name: /Registry settings/i })).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);

    const settingName = visual.getByRole("button", { name: "Setting Name" }).first();
    await settingName.click();
    await expect(settingName.locator("xpath=..")).toHaveAttribute("aria-sort", "ascending");
    await settingName.click();
    await expect(settingName.locator("xpath=..")).toHaveAttribute("aria-sort", "descending");
    await settingName.click();
    await expect(settingName.locator("xpath=..")).not.toHaveAttribute("aria-sort");

    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Visual Builder" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("button", { name: "Close baseline" }).click();
    await expect(page.getByRole("heading", { name: "My Baselines" })).toBeVisible();
    await expect(
      page.getByRole("tablist", { name: "Open baselines" }).getByRole("tab", {
        name: BASELINE_A,
      }),
    ).toHaveCount(0);
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
      /Step 1: Download CIS baselines/,
      /Step 2: Import the CIS baseline files/,
      /Step 3: Re-check catalog/,
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

    await page.getByRole("button", { name: "Re-check catalog" }).click();
    await expect(page.getByText("CIS data found")).toBeVisible();
    const detected = page.getByRole("region", { name: "Detected CIS catalogs" });
    await expect(detected).toContainText("CIS Windows Server Loop E2E Benchmark");
    await expect(detected).toContainText("1 rule");
    await expect(steps).toHaveText([
      /Step 1: Download CIS baselines/,
      /Step 2: Import the CIS baseline files/,
      /Step 3: Re-check catalog/,
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
  });
});
