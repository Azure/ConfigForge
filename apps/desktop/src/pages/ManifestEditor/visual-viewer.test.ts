// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import {
  DESIRED_VALUE_COLUMN,
  SETTING_NAME_COLUMN,
  flattenVisualSettings,
  formatVisualValue,
  groupVisualSettings,
  nextVisualSort,
  sortVisualSettings,
} from "./visual-viewer";

describe("visual viewer helpers", () => {
  it("flattens top-level settings, Group children, and Test wrappers without mutating input", () => {
    const document = {
      resources: [
        {
          name: "Root registry setting",
          type: "Microsoft.Windows/Registry",
          properties: {
            keyPath: "HKLM:\\Software\\Root",
            valueName: "Enabled",
            value: 1,
          },
        },
        {
          name: "Security group",
          type: "Microsoft.OSConfig/Group",
          properties: {
            resources: [
              {
                name: "CSP child",
                type: "Microsoft.Windows/CSP",
                properties: {
                  path: "./Device/Vendor/MSFT/Policy/Config/Example",
                  value: false,
                },
              },
              {
                name: "Outer test setting",
                type: "Microsoft.OSConfig/Test",
                properties: {
                  resource: {
                    name: "Inner name must not replace the outer name",
                    type: "Microsoft.Windows/Registry",
                    properties: {
                      keyPath: "HKLM:\\Software\\Wrapped",
                      valueName: "Mode",
                      value: 2,
                    },
                  },
                  schema: { const: 2 },
                },
              },
            ],
          },
        },
      ],
    };
    const before = structuredClone(document);

    const settings = flattenVisualSettings(document);

    expect(settings).toHaveLength(3);
    expect(settings.map((setting) => setting.resourceType)).toEqual([
      "Microsoft.Windows/Registry",
      "Microsoft.Windows/CSP",
      "Microsoft.Windows/Registry",
    ]);
    expect(settings[2]).toMatchObject({
      settingName: "Outer test setting",
      resourceType: "Microsoft.Windows/Registry",
      desiredValue: 2,
      properties: {
        keyPath: "HKLM:\\Software\\Wrapped",
        valueName: "Mode",
        value: 2,
      },
    });
    expect(settings[2].properties).not.toHaveProperty("schema");
    expect(document).toEqual(before);
  });

  it("preserves compliance.equals and established desired-value conventions", () => {
    const settings = flattenVisualSettings({
      resources: [
        {
          name: "Compliance wins",
          type: "Example/Compliance",
          properties: { value: 99 },
          compliance: { equals: 0 },
        },
        {
          name: "Top-level value",
          type: "Example/TopLevel",
          value: false,
          properties: { description: "kept" },
        },
        {
          name: "Property desired",
          type: "Example/Property",
          properties: { desired: null },
        },
        {
          name: "No desired state",
          type: "Example/None",
          properties: { description: "informational" },
        },
      ],
    });

    expect(settings[0]).toMatchObject({ desiredValue: 0 });
    expect(settings[1]).toMatchObject({ desiredValue: false });
    expect(settings[2]).toHaveProperty("desiredValue", null);
    expect(settings[3]).not.toHaveProperty("desiredValue");

    const groups = groupVisualSettings({
      resources: [
        {
          name: "With desired state",
          type: "Example/Shared",
          properties: { path: "one" },
          compliance: { equals: "enabled" },
        },
        {
          name: "Without desired state",
          type: "Example/Shared",
          properties: { path: "two" },
        },
        {
          name: "Separate type",
          type: "Example/Informational",
          properties: { path: "three" },
        },
      ],
    });

    expect(groups[0].columns).toEqual([
      SETTING_NAME_COLUMN,
      DESIRED_VALUE_COLUMN,
      "path",
    ]);
    expect(groups[1].columns).toEqual([SETTING_NAME_COLUMN, "path"]);
  });

  it("extracts concise Test desired values from the shipped LAPS fixture", () => {
    const source = readFileSync(
      resolve(process.cwd(), "public", "_baselines", "laps.osc.yaml"),
      "utf8",
    );
    const settings = flattenVisualSettings(yaml.load(source));
    const byName = new Map(settings.map((setting) => [setting.settingName, setting]));

    expect(byName.get("PasswordBackup")).toMatchObject({
      resourceType: "Microsoft.Windows/Registry",
      desiredValue: 2,
      properties: { value: 1 },
    });
    expect(byName.get("PasswordComplexity")).toMatchObject({ desiredValue: 4 });
    expect(byName.get("AdminAccountName")).toMatchObject({ desiredValue: 0 });
    expect(byName.get("PasswordLength")?.desiredValue).toEqual({
      minimum: 15,
      maximum: 64,
    });
    expect(formatVisualValue(byName.get("PasswordLength")?.desiredValue)).toBe(
      '{\n  "minimum": 15,\n  "maximum": 64\n}',
    );
  });

  it("supports Test schema equals and avoids exposing a large schema when const is concise", () => {
    const [equalsSetting, constSetting] = flattenVisualSettings({
      resources: [
        {
          name: "Equals wrapper",
          type: "Microsoft.OSConfig/Test",
          properties: {
            resource: {
              type: "Example/Inner",
              properties: { path: "equals" },
            },
            schema: { equals: "enabled" },
          },
        },
        {
          name: "Const wrapper",
          type: "Microsoft.OSConfig/Test",
          properties: {
            resource: {
              type: "Example/Inner",
              properties: { path: "const" },
            },
            schema: {
              $defs: { verbose: { description: "x".repeat(2_000) } },
              const: true,
            },
          },
        },
      ],
    });

    expect(equalsSetting.desiredValue).toBe("enabled");
    expect(constSetting.desiredValue).toBe(true);
    expect(formatVisualValue(constSetting.desiredValue)).toBe("true");
  });

  it("derives deterministic names for unnamed children in the shipped Linux SFF Groups", () => {
    const source = readFileSync(
      resolve(process.cwd(), "public", "_baselines", "sff-linux-baseline.osc.yaml"),
      "utf8",
    );
    const firstPass = flattenVisualSettings(yaml.load(source));
    const secondPass = flattenVisualSettings(yaml.load(source));

    expect(firstPass.map(({ id, settingName }) => ({ id, settingName }))).toEqual(
      secondPass.map(({ id, settingName }) => ({ id, settingName })),
    );
    expect(firstPass.every((setting) => setting.settingName.trim().length > 0)).toBe(true);
    expect(firstPass.map((setting) => setting.settingName)).toEqual(
      expect.arrayContaining([
        "Disable USB Storage — File 1",
        "Disable USB Storage — KernelModule 2",
        "Ensure Avahi Server is not enabled — File 1",
        "Ensure Avahi Server is not enabled — File 2",
      ]),
    );
  });

  it("groups by effective resource type and unions property columns in first-seen order", () => {
    const groups = groupVisualSettings({
      resources: [
        {
          name: "First",
          type: "Microsoft.Windows/Registry",
          properties: { keyPath: "A", value: 1 },
        },
        {
          name: "Second",
          type: "Microsoft.Windows/Registry",
          properties: { valueName: "B", valueType: "Dword", value: 2 },
        },
        {
          name: "Linux",
          type: "Linux/User",
          properties: { userName: "configforge" },
        },
      ],
    });

    expect(groups.map((group) => group.resourceType)).toEqual([
      "Microsoft.Windows/Registry",
      "Linux/User",
    ]);
    expect(groups[0].columns).toEqual([
      SETTING_NAME_COLUMN,
      DESIRED_VALUE_COLUMN,
      "keyPath",
      "value",
      "valueName",
      "valueType",
    ]);
    expect(groups[1].columns).toEqual([SETTING_NAME_COLUMN, "userName"]);
  });

  it("formats complete primitive, array, and object values without truncation", () => {
    const longValue = "x".repeat(500);
    const objectValue = {
      enabled: true,
      nested: { paths: ["C:\\One", "C:\\Two"], description: longValue },
    };

    expect(formatVisualValue(longValue)).toBe(longValue);
    expect(formatVisualValue(false)).toBe("false");
    expect(formatVisualValue(null)).toBe("null");
    expect(formatVisualValue(["one", { two: 2 }])).toBe('[\n  "one",\n  {\n    "two": 2\n  }\n]');

    const formattedObject = formatVisualValue(objectValue);
    expect(formattedObject).toBe(JSON.stringify(objectValue, null, 2));
    expect(formattedObject).toContain(longValue);
  });

  it("cycles ascending, descending, and unsorted while keeping equal values stable", () => {
    const settings = flattenVisualSettings({
      resources: [
        { name: "Second", type: "Example/Type", properties: { priority: 2 } },
        { name: "First equal", type: "Example/Type", properties: { priority: 1 } },
        { name: "Second equal", type: "Example/Type", properties: { priority: 1 } },
      ],
    });

    const ascending = nextVisualSort(null, "priority");
    const descending = nextVisualSort(ascending, "priority");
    const unsorted = nextVisualSort(descending, "priority");

    expect(ascending).toEqual({ column: "priority", direction: "ascending" });
    expect(descending).toEqual({ column: "priority", direction: "descending" });
    expect(unsorted).toBeNull();
    expect(sortVisualSettings(settings, ascending).map((setting) => setting.settingName)).toEqual([
      "First equal",
      "Second equal",
      "Second",
    ]);
    expect(sortVisualSettings(settings, descending).map((setting) => setting.settingName)).toEqual([
      "Second",
      "First equal",
      "Second equal",
    ]);
    expect(sortVisualSettings(settings, unsorted)).toEqual(settings);
  });

  it("returns no rows for empty or malformed resources and skips malformed wrappers safely", () => {
    expect(flattenVisualSettings(null)).toEqual([]);
    expect(flattenVisualSettings({ resources: "not-an-array" })).toEqual([]);
    expect(
      flattenVisualSettings({
        resources: [
          null,
          "bad",
          {},
          {
            name: "Broken group",
            type: "Microsoft.OSConfig/Group",
            properties: { resources: "not-an-array" },
          },
          {
            name: "Broken test",
            type: "Microsoft.OSConfig/Test",
            properties: { resource: null },
          },
          {
            type: "Example/Valid",
            properties: null,
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        settingName: "",
        resourceType: "Example/Valid",
        properties: {},
      }),
    ]);
    expect(groupVisualSettings({ resources: [] })).toEqual([]);
  });
});
