// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
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

function renderViewer() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <VisualManifestViewer source={source} />
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
    const priorityHeader = within(table).getByRole("columnheader", { name: "priority" });
    const sortButton = within(priorityHeader).getByRole("button", { name: "priority" });

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

  it("renders a Desired Value column only for categories that contain desired state", () => {
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
      within(desiredTable).getByRole("columnheader", { name: "Desired Value" }),
    ).toBeInTheDocument();
    expect(within(desiredTable).getByRole("cell", { name: "false" })).toBeInTheDocument();
    expect(
      within(informationalTable).queryByRole("columnheader", { name: "Desired Value" }),
    ).not.toBeInTheDocument();
  });
});
