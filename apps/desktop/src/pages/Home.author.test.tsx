// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter } from "react-router-dom";
import { getI18n } from "../locales";

vi.mock("../lib/flavor", () => ({
  FLAVOR: "author",
  HAS_ACTIVITY_FEED: true,
  HAS_DEPLOY: false,
  HAS_DEVICE_AUDIT: false,
  HAS_ELEVATION: false,
  HAS_HEALTH: false,
}));

vi.mock("../hooks/useCliPresence", () => ({
  useCliPresence: () => ({ loading: false, installed: false }),
}));

import { HomePage } from "./Home";

const originalCfs = window.cfs;
let forbiddenNamespaceRead: ReturnType<typeof vi.fn>;
let activityRecent: ReturnType<typeof vi.fn>;

function renderHome() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </FluentProvider>,
  );
}

describe("HomePage author flavor", () => {
  beforeEach(async () => {
    await getI18n().changeLanguage("en");
    window.localStorage.clear();
    forbiddenNamespaceRead = vi.fn(() => {
      throw new Error("author flavor must not read a device namespace");
    });
    activityRecent = vi.fn().mockResolvedValue({
      data: [
        {
          type: "registered",
          name: "baseline-one",
          timestamp: "2026-07-18T08:00:00.000Z",
          message: "Manifest registered",
        },
        {
          type: "registered",
          name: "baseline-one",
          timestamp: "2026-07-18T09:00:00.000Z",
          message: "AccountLockoutThreshold modified",
        },
      ],
    });

    const authorCfs: Record<string, unknown> = {
      manifests: {
        list: vi.fn().mockResolvedValue({ data: [{ Name: "baseline-one" }] }),
      },
      activity: {
        recent: activityRecent,
      },
    };
    for (const namespace of ["health", "deploy", "deployRecovery", "auditResults"]) {
      Object.defineProperty(authorCfs, namespace, {
        configurable: true,
        get: forbiddenNamespaceRead,
      });
    }
    Object.defineProperty(window, "cfs", {
      writable: true,
      configurable: true,
      value: authorCfs,
    });
  });

  afterEach(async () => {
    Object.defineProperty(window, "cfs", {
      writable: true,
      configurable: true,
      value: originalCfs,
    });
    await getI18n().changeLanguage("en");
  });

  it("shows author activity without reading deploy, audit, or health namespaces", async () => {
    renderHome();

    await waitFor(() => expect(activityRecent).toHaveBeenCalledOnce());
    expect(await screen.findByText("Manifest registered")).toBeInTheDocument();
    expect(screen.getByText("AccountLockoutThreshold modified")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent Activity" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "System Health" })).not.toBeInTheDocument();
    expect(screen.queryByText("Audit compliance")).not.toBeInTheDocument();
    expect(forbiddenNamespaceRead).not.toHaveBeenCalled();
  });
});
