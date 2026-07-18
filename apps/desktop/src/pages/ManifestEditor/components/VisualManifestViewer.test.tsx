// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
    expect(
      within(table).getByRole("columnheader", { name: "Registry path" }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", { name: "Value name" }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", { name: "Value type" }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", { name: "Applied value" }),
    ).toBeInTheDocument();
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
        expect(
          within(table).getByRole("columnheader", { name: header }),
        ).toBeInTheDocument();
      }
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("edits spreadsheet cells inline and synchronizes canonical YAML", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditable(source, onChange);

    await user.click(
      screen.getByRole("button", { name: "Edit Setting Name for Later" }),
    );
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

  it("adds blank rows directly in the table and opens the new name cell", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditable(source, onChange);
    const category = screen.getByRole("heading", { name: "Category" }).closest("section");
    expect(category).not.toBeNull();

    await user.click(within(category!).getByRole("button", { name: "Add row" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole("textbox", {
        name: "Edit Setting Name for Unnamed setting",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Complete 1 required cell before saving.",
    );
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

  it("commits the final cell with Enter and appends another row", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditable(source, onChange);

    await user.click(
      screen.getByRole("button", { name: "Edit Details for Second equal" }),
    );
    const input = screen.getByRole("textbox", {
      name: "Edit Details for Second equal",
    });
    await user.type(input, "updated{Enter}");

    expect(
      await screen.findByRole("textbox", {
        name: "Edit Setting Name for Unnamed setting",
      }),
    ).toBeInTheDocument();
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

  it("adds a known resource type without opening the retired form picker", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditable("resources: []\n", onChange);

    await user.click(screen.getByRole("button", { name: "Add setting" }));
    await user.click(
      screen.getByRole("menuitem", { name: /Registry[\s\S]*Microsoft\.Windows\/Registry/ }),
    );

    const document = parseVisualManifest(onChange.mock.calls[0][0]) as {
      resources: Array<{ type: string; properties: Record<string, unknown> }>;
    };
    expect(document.resources[0]).toMatchObject({
      type: "Microsoft.Windows/Registry",
      properties: {
        keyPath: "",
        valueName: "",
        valueType: "String",
        value: "",
      },
    });
    expect(screen.queryByText("Manage Windows registry keys and values")).not.toBeInTheDocument();
  });

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
  });
});
