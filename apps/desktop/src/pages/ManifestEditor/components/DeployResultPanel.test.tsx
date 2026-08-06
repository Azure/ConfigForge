// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getI18n } from "../../../locales";
import { DeployResultPanel } from "./DeployResultPanel";

beforeEach(async () => {
  await getI18n().changeLanguage("en");
});

describe("DeployResultPanel verified enforcement failure", () => {
  it("uses the red failure state and keeps the resource table available", () => {
    const { container } = render(
      <DeployResultPanel
        deployResult={{
          success: false,
          message: 'Enforcement incomplete for "sample"',
          warning:
            "Inspect the noncompliant resource results and the OSConfig provider, installed version, and logs.",
          data: {
            Name: "sample",
            Deployed: false,
            DeployError:
              "OSConfig accepted the apply command, but 1 resource remains noncompliant after verification.",
            Hostname: "host",
            Timestamp: "2026-08-05T00:00:00Z",
            TotalResources: 1,
            Compliant: 0,
            NonCompliant: 1,
            Indeterminate: 0,
            Errors: 0,
            Resources: [
              {
                name: "FailedRule",
                type: "Microsoft.Windows/Registry",
                status: "noncompliant",
                reason: "Expected 1, found 0",
              },
            ],
          },
        }}
        setDeployResult={vi.fn()}
        deployRowsShowAll={false}
        setDeployRowsShowAll={vi.fn()}
      />,
    );

    expect(container.firstElementChild).toHaveClass("border-red-200");
    expect(screen.getByText(/Enforcement incomplete/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("View 1 settings"));
    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getByText("FailedRule")).toBeVisible();
    expect(screen.getByText("noncompliant")).toBeVisible();
  });

  it("uses the amber warning state when enforcement cannot be fully verified", () => {
    const { container } = render(
      <DeployResultPanel
        deployResult={{
          success: true,
          message: 'Manifest "sample" applied; enforcement verification is incomplete',
          warning: "1 of 1 resources could not be verified.",
          data: {
            Name: "sample",
            Deployed: true,
            DeployError: null,
            Hostname: "host",
            Timestamp: "2026-08-05T00:00:00Z",
            TotalResources: 1,
            Compliant: 0,
            NonCompliant: 0,
            Indeterminate: 1,
            Errors: 0,
            Resources: [
              {
                name: "UnreadableRule",
                type: "Microsoft.Windows/Registry",
                status: "indeterminate",
                reason: "Provider read failed",
              },
            ],
          },
        }}
        setDeployResult={vi.fn()}
        deployRowsShowAll={false}
        setDeployRowsShowAll={vi.fn()}
      />,
    );

    expect(container.firstElementChild).toHaveClass("border-amber-200");
    expect(screen.getByText(/verification is incomplete/i)).toBeInTheDocument();
  });
});
