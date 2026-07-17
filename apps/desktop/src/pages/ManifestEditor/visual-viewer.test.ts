// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import {
  DESIRED_VALUE_COLUMN,
  SETTING_NAME_COLUMN,
  addVisualSettingSource,
  compareVisualValues,
  dumpVisualManifest,
  flattenVisualSettings,
  formatVisualValue,
  groupVisualSettings,
  nextVisualSort,
  parseLosslessJson,
  parseVisualManifest,
  parseVisualCellInput,
  removeVisualSettingsSource,
  sortVisualSettings,
  stringifyLosslessJson,
  updateVisualCellSource,
  validateVisualSettings,
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

    expect(groups[0].columns).toEqual([SETTING_NAME_COLUMN, DESIRED_VALUE_COLUMN, "path"]);
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

  it("uses a transitive fixed type precedence for mixed visual values", () => {
    const ordered: unknown[] = [null, false, true, -1, 2, 10n, "10", "2", [1], { rank: 1 }];

    for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
      for (let rightIndex = 0; rightIndex < ordered.length; rightIndex += 1) {
        const leftToRight = Math.sign(compareVisualValues(ordered[leftIndex], ordered[rightIndex]));
        const rightToLeft = Math.sign(compareVisualValues(ordered[rightIndex], ordered[leftIndex]));
        expect(leftToRight + rightToLeft).toBe(0);
        expect(leftToRight).toBe(leftIndex === rightIndex ? 0 : leftIndex < rightIndex ? -1 : 1);
      }
    }

    for (let first = 0; first < ordered.length; first += 1) {
      for (let second = first; second < ordered.length; second += 1) {
        for (let third = second; third < ordered.length; third += 1) {
          expect(compareVisualValues(ordered[first], ordered[second])).toBeLessThanOrEqual(0);
          expect(compareVisualValues(ordered[second], ordered[third])).toBeLessThanOrEqual(0);
          expect(compareVisualValues(ordered[first], ordered[third])).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  it("sorts numbers, numeric strings, booleans, null, and objects deterministically then restores source order", () => {
    const settings = flattenVisualSettings({
      resources: [
        { name: "Object two", type: "Example/Type", properties: { value: { rank: 2 } } },
        { name: "String ten", type: "Example/Type", properties: { value: "10" } },
        { name: "True", type: "Example/Type", properties: { value: true } },
        { name: "Null", type: "Example/Type", properties: { value: null } },
        { name: "Number two", type: "Example/Type", properties: { value: 2 } },
        { name: "String two", type: "Example/Type", properties: { value: "2" } },
        { name: "False", type: "Example/Type", properties: { value: false } },
        { name: "Object one", type: "Example/Type", properties: { value: { rank: 1 } } },
        { name: "Number ten", type: "Example/Type", properties: { value: 10 } },
      ],
    });
    const sourceOrder = settings.map((setting) => setting.settingName);
    const ascending = nextVisualSort(null, "value");
    const descending = nextVisualSort(ascending, "value");
    const unsorted = nextVisualSort(descending, "value");

    expect(sortVisualSettings(settings, ascending).map((setting) => setting.settingName)).toEqual([
      "Null",
      "False",
      "True",
      "Number two",
      "Number ten",
      "String ten",
      "String two",
      "Object one",
      "Object two",
    ]);
    expect(sortVisualSettings(settings, descending).map((setting) => setting.settingName)).toEqual([
      "Object two",
      "Object one",
      "String two",
      "String ten",
      "Number ten",
      "Number two",
      "True",
      "False",
      "Null",
    ]);
    expect(sortVisualSettings(settings, unsorted).map((setting) => setting.settingName)).toEqual(
      sourceOrder,
    );
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

  it("round-trips unsafe QWord integers without precision loss", () => {
    const source = `resources:
  - name: Exact QWord
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM:\\Software\\ConfigForge
      valueName: Exact
      valueType: QWord
      value: 18446744073709551615
`;
    const document = parseVisualManifest(source);
    const dumped = dumpVisualManifest(document);

    expect(dumped).toContain("18446744073709551615");
    expect(dumped).not.toContain("18446744073709552000");
    expect(flattenVisualSettings(parseVisualManifest(dumped))[0].properties.value).toBe(
      18446744073709551615n,
    );
  });

  it("round-trips unsafe integers through strict JSON without quoting them", () => {
    const value = {
      safe: 42,
      maximumQWord: 18446744073709551615n,
      nested: [9007199254740993n],
      text: "18446744073709551615",
    };
    const json = stringifyLosslessJson(value, 2);

    expect(json).toContain('"maximumQWord": 18446744073709551615');
    expect(json).toContain("9007199254740993");
    expect(json).toContain('"text": "18446744073709551615"');
    expect(parseLosslessJson(json ?? "")).toEqual(value);
    expect(() => parseLosslessJson("{unquoted: true}")).toThrow();
  });

  it("keeps nested QWord tokens numeric when a structured cell is opened and committed", () => {
    const source = `resources:
  - name: Structured bounds
    type: Microsoft.OSConfig/Test
    properties:
      schema:
        minimum: 9007199254740993
        maximum: 18446744073709551615
      resource:
        type: Example/Inner
        properties:
          path: example
`;
    const [setting] = flattenVisualSettings(parseVisualManifest(source));
    const draft = formatVisualValue(setting.desiredValue);
    const result = updateVisualCellSource(source, setting, DESIRED_VALUE_COLUMN, draft);

    expect(draft).toContain('"minimum": 9007199254740993');
    expect(draft).not.toContain('"9007199254740993"');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [updated] = flattenVisualSettings(parseVisualManifest(result.source));
    expect(updated.desiredValue).toEqual({
      minimum: 9007199254740993n,
      maximum: 18446744073709551615n,
    });
  });

  it("edits Test wrapper names, inner properties, and schema desired values in place", () => {
    const source = `metadata:
  owner: security-team
resources:
  - name: Outer setting
    type: Microsoft.OSConfig/Test
    customWrapperField: preserved
    properties:
      schema:
        const: 2
        description: Keep this constraint
      resource:
        name: Inner implementation
        type: Microsoft.Windows/Registry
        customLeafField: preserved
        properties:
          keyPath: HKLM:\\Software\\Example
          valueName: Mode
          valueType: Dword
          value: 1
`;
    let current = source;
    let setting = flattenVisualSettings(parseVisualManifest(current))[0];
    expect(setting.settingName).toBe("Outer setting");

    const renamed = updateVisualCellSource(current, setting, SETTING_NAME_COLUMN, "Renamed outer");
    if (!renamed.ok) throw new Error(renamed.error);
    current = renamed.source;

    setting = flattenVisualSettings(parseVisualManifest(current))[0];
    const propertyEdit = updateVisualCellSource(current, setting, "value", "5");
    expect(propertyEdit.ok).toBe(true);
    if (!propertyEdit.ok) return;
    current = propertyEdit.source;

    setting = flattenVisualSettings(parseVisualManifest(current))[0];
    const desiredEdit = updateVisualCellSource(current, setting, DESIRED_VALUE_COLUMN, "7");
    expect(desiredEdit.ok).toBe(true);
    if (!desiredEdit.ok) return;

    const document = parseVisualManifest(desiredEdit.source) as {
      metadata: { owner: string };
      resources: Array<{
        name: string;
        customWrapperField: string;
        properties: {
          schema: { const: number; description: string };
          resource: {
            name: string;
            customLeafField: string;
            properties: { value: number };
          };
        };
      }>;
    };
    const wrapper = document.resources[0];
    expect(document.metadata.owner).toBe("security-team");
    expect(wrapper.name).toBe("Renamed outer");
    expect(wrapper.customWrapperField).toBe("preserved");
    expect(wrapper.properties.resource.name).toBe("Inner implementation");
    expect(wrapper.properties.resource.customLeafField).toBe("preserved");
    expect(wrapper.properties.resource.properties.value).toBe(5);
    expect(wrapper.properties.schema).toEqual({
      const: 7,
      description: "Keep this constraint",
    });
  });

  it("removes selected top-level and nested Group settings without shifting the wrong rows", () => {
    const source = `resources:
  - name: Keep top
    type: Example/Type
    properties:
      value: 1
  - name: Group
    type: Microsoft.OSConfig/Group
    properties:
      resources:
        - name: Remove child
          type: Example/Type
          properties:
            value: 2
        - name: Keep child
          type: Example/Type
          properties:
            value: 3
  - name: Remove top
    type: Example/Type
    properties:
      value: 4
`;
    const settings = flattenVisualSettings(parseVisualManifest(source));
    const selected = settings.filter((setting) =>
      ["Remove child", "Remove top"].includes(setting.settingName),
    );
    const result = removeVisualSettingsSource(source, selected);

    if (!result.ok) throw new Error(result.error);
    expect(
      flattenVisualSettings(parseVisualManifest(result.source)).map(
        (setting) => setting.settingName,
      ),
    ).toEqual(["Keep top", "Keep child"]);
  });

  it("adds a typed blank row template and preserves custom category columns", () => {
    const result = addVisualSettingSource(
      "metadata:\n  owner: security\nresources: []\n",
      "Microsoft.Windows/Registry",
      [SETTING_NAME_COLUMN, "customProperty"],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const document = parseVisualManifest(result.source) as {
      metadata: { owner: string };
      resources: Array<{
        name: string;
        type: string;
        properties: Record<string, unknown>;
      }>;
    };
    expect(document.metadata.owner).toBe("security");
    expect(document.resources[0]).toMatchObject({
      name: "",
      type: "Microsoft.Windows/Registry",
      properties: {
        keyPath: "",
        valueName: "",
        valueType: "String",
        value: "",
        customProperty: "",
      },
    });
  });

  it("identifies incomplete required cells in newly added top-level rows", () => {
    const added = addVisualSettingSource(
      "resources: []\n",
      "Microsoft.Windows/Registry",
    );
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const settings = flattenVisualSettings(parseVisualManifest(added.source));
    expect(validateVisualSettings(settings)).toEqual([
      { settingId: "0", column: SETTING_NAME_COLUMN },
      { settingId: "0", column: "keyPath" },
      { settingId: "0", column: "valueName" },
    ]);
  });

  it("does not reject unnamed nested Group children from existing baselines", () => {
    const settings = flattenVisualSettings({
      resources: [
        {
          name: "Group",
          type: "Microsoft.OSConfig/Group",
          properties: {
            resources: [
              {
                type: "Microsoft.OSConfig/File",
                properties: { path: "/etc/example", exists: true },
              },
            ],
          },
        },
      ],
    });

    expect(settings[0].hasExplicitName).toBe(false);
    expect(validateVisualSettings(settings)).toEqual([]);
  });

  it("rejects invalid typed spreadsheet values without changing source", () => {
    const [setting] = flattenVisualSettings({
      resources: [
        {
          name: "Boolean",
          type: "Microsoft.OSConfig/File",
          properties: { path: "/tmp/example", exists: true },
        },
      ],
    });

    expect(parseVisualCellInput("sometimes", true, setting, "exists")).toEqual({
      ok: false,
      error: "boolean",
    });
    expect(
      updateVisualCellSource(
        `resources:
  - name: Boolean
    type: Microsoft.OSConfig/File
    properties:
      path: /tmp/example
      exists: true
`,
        setting,
        "exists",
        "sometimes",
      ),
    ).toEqual({ ok: false, error: "boolean" });
  });

  it("updates unwrapped typed desired values without replacing their wrapper", () => {
    const source = `resources:
  - name: Typed value
    type: Example/Typed
    properties:
      path: example
      desired:
        integer: 4
`;
    const [setting] = flattenVisualSettings(parseVisualManifest(source));
    const result = updateVisualCellSource(source, setting, DESIRED_VALUE_COLUMN, "9");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const document = parseVisualManifest(result.source) as {
      resources: Array<{ properties: { desired: { integer: number } } }>;
    };
    expect(document.resources[0].properties.desired).toEqual({ integer: 9 });
  });
});
