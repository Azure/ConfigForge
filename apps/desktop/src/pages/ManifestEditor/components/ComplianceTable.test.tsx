// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { OscResource } from "@configforge/core/types";
import { getI18n } from "../../../locales";
import { ComplianceTable } from "./ComplianceTable";

const resources: OscResource[] = [
  {
    name: "NonCompliantRule",
    type: "Microsoft.Windows/Registry",
    properties: {},
    compliance: { status: "NonCompliant", reason: "Expected 1, found 0" },
  },
  {
    name: "CompliantRule",
    type: "Microsoft.Windows/Registry",
    properties: {},
    compliance: { status: "Compliant", reason: "Matches desired value" },
  },
  {
    name: "CouldNotReadRule",
    type: "Microsoft.Windows/CSP",
    properties: {},
    compliance: { status: "Indeterminate", reason: "Permission denied" },
  },
  {
    name: "ErrorRule",
    type: "Linux/FilePermission",
    properties: {},
    compliance: { status: "Error", reason: "Provider unavailable" },
  },
];

function Harness() {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  return (
    <ComplianceTable
      resources={resources}
      expandedResource={expanded}
      setExpandedResource={setExpanded}
      complianceShowAll={showAll}
      setComplianceShowAll={setShowAll}
      showHeader={false}
    />
  );
}

function visibleSettingNames(): string[] {
  const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
  return rows.map((row) => within(row).getAllByRole("cell")[1]?.textContent ?? "");
}

beforeEach(async () => {
  await getI18n().changeLanguage("en");
});

describe("ComplianceTable report controls", () => {
  it("searches names, types, and reasons and filters by status", () => {
    render(<Harness />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search compliance report" }), {
      target: { value: "permission denied" },
    });
    expect(visibleSettingNames()).toEqual(["CouldNotReadRule"]);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search compliance report" }), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter compliance status" }), {
      target: { value: "unread" },
    });
    expect(visibleSettingNames()).toEqual(["CouldNotReadRule", "ErrorRule"]);

    fireEvent.change(screen.getByRole("combobox", { name: "Filter compliance status" }), {
      target: { value: "noncompliant" },
    });
    expect(visibleSettingNames()).toEqual(["NonCompliantRule"]);
  });

  it("cycles status sorting between ascending, descending, and original order", () => {
    render(<Harness />);
    const sort = screen.getByRole("button", { name: "Sort by compliance status" });
    const statusHeader = screen.getByRole("columnheader", { name: /Status/ });

    expect(visibleSettingNames()).toEqual([
      "NonCompliantRule",
      "CompliantRule",
      "CouldNotReadRule",
      "ErrorRule",
    ]);

    fireEvent.click(sort);
    expect(statusHeader).toHaveAttribute("aria-sort", "ascending");
    expect(visibleSettingNames()).toEqual([
      "CompliantRule",
      "CouldNotReadRule",
      "ErrorRule",
      "NonCompliantRule",
    ]);

    fireEvent.click(sort);
    expect(statusHeader).toHaveAttribute("aria-sort", "descending");
    expect(visibleSettingNames()).toEqual([
      "NonCompliantRule",
      "CouldNotReadRule",
      "ErrorRule",
      "CompliantRule",
    ]);

    fireEvent.click(sort);
    expect(statusHeader).not.toHaveAttribute("aria-sort");
    expect(visibleSettingNames()).toEqual([
      "NonCompliantRule",
      "CompliantRule",
      "CouldNotReadRule",
      "ErrorRule",
    ]);
  });
});
