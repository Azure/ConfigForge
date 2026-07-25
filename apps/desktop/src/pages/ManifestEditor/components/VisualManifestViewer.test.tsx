// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { getI18n } from "../../../locales";
import { parseVisualManifest } from "../visual-viewer";
import { VisualManifestViewer } from "./VisualManifestViewer";

const source = `resources:
  - name: Later
    type: Example/Category
    properties:
      priority: 2
      details:
        enabled: true
        paths:
          - C:\\One
          - C:\\Two
  - name: First equal
    type: Example/Category
    properties:
      priority: 1
  - name: Second equal
    type: Example/Category
    properties:
      priority: 1
  - name: Other category
    type: Example/Other
    properties:
      completeValue: This value must remain completely visible
`;

function renderViewer(yamlSource = source) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <VisualManifestViewer source={yamlSource} />
    </FluentProvider>,
  );
}

function EditableHarness({
  initialSource = source,
  onChange,
  onValidityChange,
}: {
  initialSource?: string;
  onChange?: (source: string) => void;
  onValidityChange?: (valid: boolean) => void;
}) {
  const [current, setCurrent] = useState(initialSource);
  return (
    <VisualManifestViewer
      source={current}
      editable
      autoFocusFirstCell={false}
      platform="windows"
      onDraftValidityChange={onValidityChange}
      onSourceChange={(next) => {
        setCurrent(next);
        onChange?.(next);
      }}
    />
  );
}

function renderEditable(
  initialSource = source,
  onChange?: (source: string) => void,
  onValidityChange?: (valid: boolean) => void,
) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <EditableHarness
        initialSource={initialSource}
        onChange={onChange}
        onValidityChange={onValidityChange}
      />
    </FluentProvider>,
  );
}

function settingNames(table: HTMLElement): string[] {
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0].textContent ?? "");
}

describe("VisualManifestViewer", () => {
  it("renders one independently scrollable table per non-empty resource type with full values", () => {
    renderViewer();

    expect(screen.getByRole("region", { name: "Visual baseline settings" })).toHaveClass(
      "overflow-y-auto",
    );
    expect(screen.getAllByRole("table")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Category" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Other" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    const objectCell = screen.getByTitle(/"enabled": true/);
    expect(objectCell).toHaveTextContent('"enabled": true');
    expect(objectCell).toHaveTextContent('"C:\\\\One"');
    expect(objectCell).toHaveTextContent('"C:\\\\Two"');
    expect(screen.getByTitle("This value must remain completely visible")).toHaveTextContent(
      "This value must remain completely visible",
    );

    for (const table of screen.getAllByRole("table")) {
      expect(table.parentElement).toHaveClass("overflow-x-auto");
    }
  });

  it("sorts a column ascending, descending, then restores stable source order", async () => {
    const user = userEvent.setup();
    renderViewer();
    const table = screen.getAllByRole("table")[0];
    const priorityHeader = within(table).getByRole("columnheader", { name: "Priority" });
    const sortButton = within(priorityHeader).getByRole("button", { name: "Priority" });

    expect(priorityHeader).not.toHaveAttribute("aria-sort");
    expect(within(sortButton).queryByTestId("sort-direction-icon")).not.toBeInTheDocument();

    await user.click(sortButton);
    expect(priorityHeader).toHaveAttribute("aria-sort", "ascending");
    expect(settingNames(table)).toEqual(["First equal", "Second equal", "Later"]);

    await user.click(sortButton);
    expect(priorityHeader).toHaveAttribute("aria-sort", "descending");
    expect(settingNames(table)).toEqual(["Later", "First equal", "Second equal"]);

    await user.click(sortButton);
    expect(priorityHeader).not.toHaveAttribute("aria-sort");
    expect(settingNames(table)).toEqual(["Later", "First equal", "Second equal"]);
    expect(within(sortButton).queryByTestId("sort-direction-icon")).not.toBeInTheDocument();
  });

  it("shows view-only feedback above a clicked table cell until the pointer moves", () => {
    renderViewer();
    const region = screen.getByRole("region", { name: "Visual baseline settings" });
    const cell = screen.getByText("Later");

    fireEvent.click(cell, { clientX: 240, clientY: 180 });

    expect(screen.getByTestId("visual-readonly-tooltip")).toHaveTextContent(
      "Cannot edit in view-only mode",
    );

    fireEvent.pointerMove(region);
    expect(screen.queryByTestId("visual-readonly-tooltip")).not.toBeInTheDocument();
  });

  it("renders an Expected value column only for categories that contain desired state", () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <VisualManifestViewer
          source={`resources:
  - name: Expected
    type: Example/Desired
    properties:
      path: one
    compliance:
      equals: false
  - name: Informational
    type: Example/Informational
    properties:
      path: two
`}
        />
      </FluentProvider>,
    );

    const [desiredTable, informationalTable] = screen.getAllByRole("table");
    expect(
      within(desiredTable).getByRole("columnheader", { name: "Expected value" }),
    ).toBeInTheDocument();
    expect(within(desiredTable).getByRole("cell", { name: "false" })).toBeInTheDocument();
    expect(
      within(informationalTable).queryByRole("columnheader", { name: "Expected value" }),
    ).not.toBeInTheDocument();
  });

  it("renders Test enum and range rules as stacked technical rows in view and edit modes", () => {
    const schemaSource = `resources:
  - name: Allowed mode
    type: Microsoft.OSConfig/Test
    properties:
      schema:
        enum:
          - 0
          - 1
          - 2
          - 99
          - 100
      resource:
        type: Microsoft.Windows/Registry
        properties:
          keyPath: HKLM:\\Software\\Example
          valueName: Mode
          valueType: Dword
          value: 99
  - name: Timeout
    type: Microsoft.OSConfig/Test
    properties:
      schema:
        minimum: 2000
        maximum: 5000
      resource:
        type: Microsoft.Windows/Registry
        properties:
          keyPath: HKLM:\\Software\\Example
          valueName: Timeout
          valueType: Dword
          value: 3000
  - name: Complex pattern
    type: Microsoft.OSConfig/Test
    properties:
      schema:
        pattern: (a)
      resource:
        type: Microsoft.Windows/Registry
        properties:
          keyPath: HKLM:\\Software\\Example
          valueName: ComplexPattern
          valueType: String
          value: a
`;
    const view = renderViewer(schemaSource);

    const [enumRules, rangeRules] = screen.getAllByTestId("visual-schema-rules");
    expect(within(enumRules).getByText("enum")).toBeInTheDocument();
    expect(
      within(enumRules)
        .getAllByText(/^(0|1|2|99|100)$/)
        .map((element) => element.textContent),
    ).toEqual(["0", "1", "2", "99", "100"]);
    expect(within(rangeRules).getByText("minimum")).toBeInTheDocument();
    expect(within(rangeRules).getByText("2000")).toBeInTheDocument();
    expect(within(rangeRules).getByText("maximum")).toBeInTheDocument();
    expect(within(rangeRules).getByText("5000")).toBeInTheDocument();
    expect(screen.getByText("Reference only")).toHaveAttribute(
      "title",
      "Visual editing displays this rule but does not enforce it.",
    );

    view.unmount();
    renderEditable(schemaSource);
    const editButton = screen.getByRole("button", {
      name: "Edit Expected value for Allowed mode",
    });
    expect(within(editButton).getByTestId("visual-schema-rules")).toBeInTheDocument();
  });

  it("displays QWord integers above Number.MAX_SAFE_INTEGER exactly", () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <VisualManifestViewer
          source={`resources:
  - name: First QWord
    type: Microsoft.Windows/Registry
    properties:
      valueName: First
      valueType: QWord
      value: 9007199254740993
  - name: Maximum QWord
    type: Microsoft.Windows/Registry
    properties:
      valueName: Maximum
      valueType: QWord
      value: 18446744073709551615
`}
        />
      </FluentProvider>,
    );

    expect(screen.getAllByTitle("9007199254740993")).toHaveLength(2);
    expect(screen.getAllByTitle("18446744073709551615")).toHaveLength(2);
    for (const cell of screen.getAllByTitle("9007199254740993")) {
      expect(cell).toHaveTextContent("9007199254740993");
    }
    for (const cell of screen.getAllByTitle("18446744073709551615")) {
      expect(cell).toHaveTextContent("18446744073709551615");
    }
    expect(screen.queryByText("9007199254740992")).not.toBeInTheDocument();
  });

  it("retains default js-yaml support for leading-zero decimal integers", () => {
    renderViewer(`resources:
  - name: Leading Zero
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM\\\\Software\\\\ConfigForge
      valueName: LeadingZero
      valueType: Dword
      value: 012
`);

    expect(screen.getAllByTitle("12")).toHaveLength(2);
    for (const cell of screen.getAllByTitle("12")) {
      expect(cell).toHaveTextContent("12");
    }
    expect(screen.queryByText(/Could not parse/i)).not.toBeInTheDocument();
    expect(screen.queryByText("18446744073709552000")).not.toBeInTheDocument();
  });

  it("uses a fit-first table without transparent sticky columns", () => {
    renderViewer(`resources:
  - name: A very long setting name that must wrap inside its assigned column
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\\Windows\\Example
      valueName: ExampleValue
      valueType: Dword
      value: 1
`);

    const table = screen.getByRole("table", { name: "Registry settings" });
    const scrollArea = screen.getByRole("region", {
      name: "Registry settings horizontal scroll area",
    });
    expect(scrollArea).toHaveClass("overflow-x-auto", "overscroll-x-contain", "isolate");
    expect(scrollArea).toHaveAttribute("tabindex", "0");
    expect(table).toHaveClass("w-full", "table-fixed");
    expect(table).not.toHaveClass("min-w-max");
    expect(Number.parseInt(table.style.minWidth, 10)).toBeGreaterThanOrEqual(1_000);
    expect(table.querySelector(".sticky")).toBeNull();
    const columnWidths = Array.from(table.querySelectorAll("col")).map(
      (column) => column.style.width,
    );
    expect(new Set(columnWidths).size).toBeGreaterThan(2);
    expect(Number.parseFloat(columnWidths[0])).toBeGreaterThan(
      Number.parseFloat(columnWidths.at(-1) ?? "0"),
    );
    expect(within(table).getByRole("columnheader", { name: "Registry path" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Value name" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Value type" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Applied value" })).toBeInTheDocument();
    expect(
      screen.getByText("A very long setting name that must wrap inside its assigned column"),
    ).toHaveClass("[overflow-wrap:anywhere]");
  });

  it("localizes every built-in column used by shipped baselines", async () => {
    const i18n = getI18n();
    await i18n.changeLanguage("fr");
    try {
      renderViewer(`resources:
  - name: Ligne
    type: Microsoft.OSConfig/FileLine
    properties:
      path: /etc/example
      find: original
      replace: replacement
      append: true
      ignoreCase: false
`);

      const table = screen.getByRole("table", { name: /FileLine/ });
      for (const header of [
        "Chemin",
        "Rechercher",
        "Remplacer",
        "Ajouter à la fin",
        "Ignorer la casse",
      ]) {
        expect(within(table).getByRole("columnheader", { name: header })).toBeInTheDocument();
      }
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("edits spreadsheet cells inline and synchronizes canonical YAML", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditable(source, onChange);

    await user.click(screen.getByRole("button", { name: "Edit Setting Name for Later" }));
    const input = screen.getByRole("textbox", {
      name: "Edit Setting Name for Later",
    });
    await user.clear(input);
    await user.type(input, "Renamed setting");
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Renamed setting")).toBeInTheDocument();
    const document = parseVisualManifest(onChange.mock.calls[0][0]) as {
      resources: Array<{ name: string }>;
    };
    expect(document.resources[0].name).toBe("Renamed setting");
  });

  it("offers matching Add setting actions above and below each table", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditable(source, onChange);
    const category = screen.getByRole("heading", { name: "Category" }).closest("section");
    expect(category).not.toBeNull();

    const addActions = within(category!).getAllByRole("button", { name: "Add setting" });
    expect(addActions).toHaveLength(2);
    expect(addActions.at(-1)?.parentElement).toHaveClass("justify-start");
    await user.click(addActions.at(-1)!);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole("textbox", {
        name: "Edit Setting Name for Unnamed setting",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Complete 1 required cell before saving.");
    const document = parseVisualManifest(onChange.mock.calls[0][0]) as {
      resources: Array<{ type: string; properties: Record<string, unknown> }>;
    };
    expect(document.resources.at(-1)).toMatchObject({
      type: "Example/Category",
      properties: {
        priority: "",
        details: "",
      },
    });
  });

  it("moves down with Enter and appends a row below the final setting", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditable(source, onChange);

    await user.click(screen.getByRole("button", { name: "Edit Details for Second equal" }));
    const input = screen.getByRole("textbox", {
      name: "Edit Details for Second equal",
    });
    await user.type(input, "updated{Enter}");

    expect(
      await screen.findByRole("textbox", {
        name: "Edit Details for Unnamed setting",
      }),
    ).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledTimes(1);
    const document = parseVisualManifest(onChange.mock.calls.at(-1)?.[0]) as {
      resources: Array<{
        name: string;
        properties: Record<string, unknown>;
      }>;
    };
    expect(document.resources).toHaveLength(5);
    expect(document.resources[2].properties.details).toBe("updated");
    expect(document.resources.at(-1)).toMatchObject({
      name: "",
      properties: { priority: "", details: "" },
    });
  });

  it("opens the Add settings pane and batch-adds selected templates", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditable("resources: []\n", onChange);

    await user.click(screen.getByRole("button", { name: "Add settings", exact: true }));
    const pane = await screen.findByRole("dialog", { name: "Add settings" });
    const backdrop = screen.getByTestId("add-settings-backdrop");
    expect(backdrop.tagName).toBe("DIV");
    expect(backdrop).not.toHaveAttribute("tabindex");
    expect(backdrop).not.toHaveAttribute("role", "button");
    expect(within(pane).getByRole("columnheader", { name: "Setting Type" })).toBeInTheDocument();
    expect(within(pane).getByRole("columnheader", { name: "OS" })).toBeInTheDocument();
    expect(within(pane).getByRole("columnheader", { name: "Setting Name" })).toBeInTheDocument();
    expect(within(pane).getByRole("columnheader", { name: "Description" })).toBeInTheDocument();
    const close = within(pane).getByRole("button", { name: "Close Add settings" });
    const cancel = within(pane).getByRole("button", { name: "Cancel" });
    cancel.focus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(cancel).toHaveFocus();
    await user.click(
      within(pane).getByRole("checkbox", {
        name: "Select Microsoft.Windows/Registry",
      }),
    );
    await user.click(
      within(pane).getByRole("checkbox", {
        name: "Select Microsoft.Windows/CSP",
      }),
    );
    await user.click(
      within(pane).getByRole("button", {
        name: "Add settings",
        exact: true,
      }),
    );

    const document = parseVisualManifest(onChange.mock.calls[0][0]) as {
      resources: Array<{ type: string; properties: Record<string, unknown> }>;
    };
    expect(document.resources.map((resource) => resource.type)).toEqual([
      "Microsoft.Windows/Registry",
      "Microsoft.Windows/CSP",
    ]);
    expect(screen.queryByRole("dialog", { name: "Add settings" })).not.toBeInTheDocument();
  });

  it("searches settings without flattening category tables", async () => {
    const user = userEvent.setup();
    renderEditable();

    await user.type(
      screen.getByRole("searchbox", { name: "Search baseline settings" }),
      "completeValue",
    );

    expect(screen.getByRole("heading", { name: "Other" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Other settings" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Category" })).not.toBeInTheDocument();
  });

  it("wraps long multi-value rows inside their cells in view mode", () => {
    const longValue = "TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384";
    renderViewer(
      `resources:
  - name: CryptographySSLCipherSuites
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\\Cryptography\\Configuration\\SSL\\00010002
      valueName: Functions
      valueType: MultiString
      value:
        - ${longValue}
        - TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA384
`,
    );

    const items = screen.getAllByText(longValue);
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item).toHaveClass(
        "min-w-0",
        "max-w-full",
        "whitespace-pre-wrap",
        "break-words",
        "[overflow-wrap:anywhere]",
      );
      expect(item.closest("button")).toBeNull();
    }
  });

  it("clears search before focusing a per-table added setting", async () => {
    const user = userEvent.setup();
    renderEditable();

    const search = screen.getByRole("searchbox", { name: "Search baseline settings" });
    await user.type(search, "Later");
    const category = screen.getByRole("heading", { name: "Category" }).closest("section");
    expect(category).not.toBeNull();
    await user.click(within(category!).getAllByRole("button", { name: "Add setting" })[0]);

    expect(search).toHaveValue("");
    expect(
      await screen.findByRole("textbox", {
        name: "Edit Setting Name for Unnamed setting",
      }),
    ).toHaveFocus();
    expect(screen.getByText("First equal")).toBeInTheDocument();
  });

  it("clears search before focusing a batch-added setting", async () => {
    const user = userEvent.setup();
    renderEditable();

    const search = screen.getByRole("searchbox", { name: "Search baseline settings" });
    await user.type(search, "completeValue");
    await user.click(screen.getByRole("button", { name: "Add settings", exact: true }));
    const pane = await screen.findByRole("dialog", { name: "Add settings" });
    await user.click(
      within(pane).getByRole("checkbox", {
        name: "Select Microsoft.Windows/Registry",
      }),
    );
    await within(pane).findByText("1 setting selected");
    fireEvent.click(
      within(pane).getByRole("button", {
        name: "Add settings",
        exact: true,
      }),
    );

    expect(search).toHaveValue("");
    expect(
      await screen.findByRole("textbox", {
        name: "Edit Setting Name for Unnamed setting",
      }),
    ).toHaveFocus();
    expect(screen.getByRole("heading", { name: "Category" })).toBeInTheDocument();
  });

  it("enables Unselect All only while rows are selected", async () => {
    const user = userEvent.setup();
    renderEditable();

    const unselect = screen.getByRole("button", { name: "Unselect All" });
    expect(unselect).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Select First equal" }));
    expect(unselect).toBeEnabled();
    await user.click(unselect);
    expect(screen.getByRole("checkbox", { name: "Select First equal" })).not.toBeChecked();
    expect(unselect).toBeDisabled();
  });

  it("shows spreadsheet instructions through the info tooltip", async () => {
    const user = userEvent.setup();
    renderEditable();

    expect(screen.queryByText("Edit settings in the table")).not.toBeInTheDocument();
    await user.hover(
      screen.getByRole("button", {
        name: "Show spreadsheet editing instructions",
      }),
    );
    expect(await screen.findByText(/Tab saves and moves right/)).toBeInTheDocument();
  });

  it("focuses the top-left cell when visual editing starts", async () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <VisualManifestViewer
          source={source}
          editable
          platform="windows"
          onSourceChange={vi.fn()}
        />
      </FluentProvider>,
    );

    expect(
      await screen.findByRole("textbox", {
        name: "Edit Setting Name for Later",
      }),
    ).toHaveFocus();
  });

  it("uses Tab to commit right and Enter to commit downward", async () => {
    const user = userEvent.setup();
    renderEditable();

    await user.click(screen.getByRole("button", { name: "Edit Setting Name for Later" }));
    const nameInput = screen.getByRole("textbox", {
      name: "Edit Setting Name for Later",
    });
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed{Tab}");
    expect(
      await screen.findByRole("textbox", {
        name: "Edit Priority for Renamed",
      }),
    ).toHaveFocus();

    await user.keyboard("{Escape}");
    await new Promise((resolve) => setTimeout(resolve, 75));
    await user.click(screen.getByRole("button", { name: "Edit Priority for Renamed" }));
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("textbox", {
        name: "Edit Priority for First equal",
      }),
    ).toHaveFocus();
  });

  it("uses Enter to commit and move down through nested multi-value items", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditable(
      `resources:
  - name: Multi-value setting
    type: Example/Category
    properties:
      priority:
        - first
        - second
      details: right
`,
      onChange,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Edit Priority value 1 for Multi-value setting",
      }),
    );
    const firstItem = screen.getByRole("textbox", {
      name: "Edit Priority value 1 for Multi-value setting",
    });
    await user.clear(firstItem);
    await user.type(firstItem, "updated{Enter}");

    expect(
      await screen.findByRole("textbox", {
        name: "Edit Priority value 2 for Multi-value setting",
      }),
    ).toHaveFocus();
    expect(onChange).toHaveBeenCalledTimes(1);
    const document = parseVisualManifest(onChange.mock.calls.at(-1)?.[0]) as {
      resources: Array<{ properties: { priority: string[] } }>;
    };
    expect(document.resources[0].properties.priority).toEqual(["updated", "second"]);
  });

  it("uses Tab to commit a nested multi-value item and move right", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditable(
      `resources:
  - name: Multi-value setting
    type: Example/Category
    properties:
      priority:
        - first
        - second
      details: right
`,
      onChange,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Edit Priority value 1 for Multi-value setting",
      }),
    );
    const firstItem = screen.getByRole("textbox", {
      name: "Edit Priority value 1 for Multi-value setting",
    });
    await user.clear(firstItem);
    await user.type(firstItem, "updated{Tab}");

    expect(
      await screen.findByRole("textbox", {
        name: "Edit Details for Multi-value setting",
      }),
    ).toHaveFocus();
    expect(onChange).toHaveBeenCalledTimes(1);
    const document = parseVisualManifest(onChange.mock.calls.at(-1)?.[0]) as {
      resources: Array<{ properties: { priority: string[] } }>;
    };
    expect(document.resources[0].properties.priority).toEqual(["updated", "second"]);
  });

  it("appends and focuses an empty array when spreadsheet navigation reaches it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditable(
      `resources:
  - name: Empty multi-value setting
    type: Example/Category
    properties:
      priority: []
      details: right
`,
      onChange,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Edit Setting Name for Empty multi-value setting",
      }),
    );
    const nameInput = screen.getByRole("textbox", {
      name: "Edit Setting Name for Empty multi-value setting",
    });
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed{Tab}");

    expect(
      await screen.findByRole("textbox", {
        name: "Edit Priority value 1 for Renamed",
      }),
    ).toHaveFocus();
    expect(onChange).toHaveBeenCalledTimes(1);
    const document = parseVisualManifest(onChange.mock.calls[0][0]) as {
      resources: Array<{ name: string; properties: { priority: string[] } }>;
    };
    expect(document.resources[0]).toMatchObject({
      name: "Renamed",
      properties: { priority: [""] },
    });
  });

  it("keeps an invalid nested draft active instead of navigating", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditable(
      `resources:
  - name: Typed values
    type: Example/Typed
    properties:
      values:
        - true
        - false
      details: right
`,
      onChange,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Edit Values value 1 for Typed values",
      }),
    );
    const firstItem = screen.getByRole("textbox", {
      name: "Edit Values value 1 for Typed values",
    });
    await user.clear(firstItem);
    await user.type(firstItem, "sometimes{Enter}");

    expect(screen.getByRole("alert")).toHaveTextContent("Enter true or false.");
    expect(firstItem).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(firstItem).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("appends and focuses a nested item when Enter reaches the final item", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditable(
      `resources:
  - name: Multi-value setting
    type: Example/Category
    properties:
      priority:
        - first
        - second
      details: right
`,
      onChange,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Edit Priority value 2 for Multi-value setting",
      }),
    );
    const finalItem = screen.getByRole("textbox", {
      name: "Edit Priority value 2 for Multi-value setting",
    });
    await user.clear(finalItem);
    await user.type(finalItem, "updated{Enter}");

    expect(
      await screen.findByRole("textbox", {
        name: "Edit Priority value 3 for Multi-value setting",
      }),
    ).toHaveFocus();
    expect(onChange).toHaveBeenCalledTimes(1);
    const document = parseVisualManifest(onChange.mock.calls[0][0]) as {
      resources: Array<{ properties: { priority: string[] } }>;
    };
    expect(document.resources[0].properties.priority).toEqual(["first", "updated", ""]);
  });

  it("preserves Shift+Enter newlines in structured nested items", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditable(
      `resources:
  - name: Structured values
    type: Example/Category
    properties:
      details:
        - enabled: true
          paths:
            - C:\\One
`,
      onChange,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Edit Details value 1 for Structured values",
      }),
    );
    const structuredItem = screen.getByRole("textbox", {
      name: "Edit Details value 1 for Structured values",
    });
    const initialDraft = (structuredItem as HTMLTextAreaElement).value;
    (structuredItem as HTMLTextAreaElement).setSelectionRange(
      initialDraft.length,
      initialDraft.length,
    );
    await user.keyboard("{Shift>}{Enter}{/Shift}");

    expect(structuredItem).toHaveFocus();
    expect(structuredItem).toHaveValue(`${initialDraft}\n`);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders multi-value attributes as nested independently editable rows", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditable(
      `resources:
  - name: Remote registry paths
    type: Microsoft.Windows/UserRightsAssignment
    properties:
      name: SeRemoteInteractiveLogonRight
      value:
        - BUILTIN\\Administrators
        - CONTOSO\\Security Admins
`,
      onChange,
    );

    expect(screen.getAllByText("BUILTIN\\Administrators").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CONTOSO\\Security Admins").length).toBeGreaterThan(0);
    expect(
      screen.queryByText("BUILTIN\\Administrators, CONTOSO\\Security Admins"),
    ).not.toBeInTheDocument();
    for (const item of screen.getAllByText("BUILTIN\\Administrators")) {
      expect(item).toHaveClass("whitespace-pre-wrap", "break-words", "[overflow-wrap:anywhere]");
    }

    await user.click(
      screen.getByRole("button", {
        name: "Edit Applied value value 2 for Remote registry paths",
      }),
    );
    const nestedInput = screen.getByRole("textbox", {
      name: "Edit Applied value value 2 for Remote registry paths",
    });
    await user.clear(nestedInput);
    await user.type(nestedInput, "CONTOSO\\Tier 0 Admins{Enter}");
    expect(screen.getAllByText("CONTOSO\\Tier 0 Admins").length).toBeGreaterThan(0);
    expect(
      await screen.findByRole("textbox", {
        name: "Edit Applied value value 3 for Remote registry paths",
      }),
    ).toHaveFocus();
    await user.keyboard("{Escape}");

    await user.click(
      screen.getByRole("button", {
        name: "Add another Applied value value for Remote registry paths",
      }),
    );
    expect(
      await screen.findByRole("textbox", {
        name: "Edit Applied value value 4 for Remote registry paths",
      }),
    ).toHaveFocus();
    expect(onChange).toHaveBeenCalled();
  });

  it("warns instead of adding the same unfinished template twice", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditable(
      `resources:
  - name: ""
    type: Microsoft.Windows/Registry
    properties:
      keyPath: ""
      valueName: ""
      valueType: String
      value: ""
`,
      onChange,
    );

    await user.click(screen.getByRole("button", { name: "Add settings", exact: true }));
    const pane = await screen.findByRole("dialog", { name: "Add settings" });
    await user.click(
      within(pane).getByRole("checkbox", {
        name: "Select Microsoft.Windows/Registry",
      }),
    );
    await within(pane).findByText("1 setting selected");
    const addSelected = within(pane).getByRole("button", {
      name: "Add settings",
      exact: true,
    });
    expect(addSelected).toBeEnabled();
    fireEvent.click(addSelected);

    expect(
      await screen.findByRole("dialog", { name: "Setting already exists" }, { timeout: 10_000 }),
    ).toHaveTextContent("Registry already has an unfinished setting");
    expect(onChange).not.toHaveBeenCalled();
  }, 20_000);

  it("bulk-deletes selected rows from the spreadsheet", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditable(source, onChange);

    await user.click(screen.getByRole("checkbox", { name: "Select First equal" }));
    await user.click(screen.getByRole("button", { name: "Delete 1 selected" }));

    expect(screen.queryByText("First equal")).not.toBeInTheDocument();
    const document = parseVisualManifest(onChange.mock.calls[0][0]) as {
      resources: Array<{ name: string }>;
    };
    expect(document.resources.map((resource) => resource.name)).toEqual([
      "Later",
      "Second equal",
      "Other category",
    ]);
  });

  it("keeps invalid typed edits in the cell and does not mutate source", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    renderEditable(
      `resources:
  - name: File state
    type: Microsoft.OSConfig/File
    properties:
      path: /tmp/configforge
      exists: true
`,
      onChange,
      onValidityChange,
    );

    await user.click(screen.getByRole("button", { name: "Edit Exists for File state" }));
    const input = screen.getByRole("textbox", { name: "Edit Exists for File state" });
    await user.clear(input);
    await user.type(input, "sometimes");
    await user.keyboard("{Enter}");

    expect(screen.getByRole("alert")).toHaveTextContent("Enter true or false.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(onChange).not.toHaveBeenCalled();
    expect(onValidityChange).toHaveBeenLastCalledWith(false);

    const search = screen.getByRole("searchbox", { name: "Search baseline settings" });
    await user.click(search);
    expect(search).toHaveFocus();
    expect(fireEvent.keyDown(search, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(search, { key: "Enter" })).toBe(true);
  });

  it("rejects governed values outside the displayed schema and accepts valid numeric edits", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    renderEditable(
      `resources:
  - name: Allowed mode
    type: Microsoft.OSConfig/Test
    properties:
      schema:
        enum:
          - 1
          - 2
          - 99
      resource:
        type: Microsoft.Windows/Registry
        properties:
          keyPath: HKLM:\\Software\\Example
          valueName: Mode
          valueType: Dword
          value: '1'
`,
      onChange,
      onValidityChange,
    );

    await user.click(screen.getByRole("button", { name: "Edit Applied value for Allowed mode" }));
    const input = screen.getByRole("textbox", { name: "Edit Applied value for Allowed mode" });
    await user.clear(input);
    await user.type(input, "3");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a value that satisfies the rules shown under Expected value.",
    );
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    await user.keyboard("{Enter}");
    expect(onChange).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, "99");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
    await user.keyboard("{Tab}");

    expect(onChange).toHaveBeenCalled();
    const emittedSources = onChange.mock.calls.map(([nextSource]) => nextSource);
    expect(new Set(emittedSources).size).toBe(1);
    const document = parseVisualManifest(emittedSources.at(-1) ?? "") as {
      resources: Array<{
        properties: { resource: { properties: { value: unknown } } };
      }>;
    };
    expect(document.resources).toHaveLength(1);
    expect(document.resources[0].properties.resource.properties.value).toBe(99);
  });
});
