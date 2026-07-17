// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { getI18n } from "../locales";

vi.mock("../lib/flavor", () => ({
  HAS_DEPLOY: false,
  HAS_ELEVATION: false,
}));

import { SettingsPage } from "./Settings";

describe("SettingsPage author flavor", () => {
  beforeEach(async () => {
    await getI18n().changeLanguage("en");
    window.localStorage.clear();
  });

  it("does not probe CLI health or offer a refresh action", async () => {
    const healthCheck = vi.fn();
    const healthRecheck = vi.fn();
    const settingsGet = vi.fn().mockResolvedValue({ historyRetention: 20 });

    Object.assign(window.cfs!, {
      health: {
        check: healthCheck,
        recheck: healthRecheck,
      },
      settings: {
        get: settingsGet,
        set: vi.fn(),
      },
    });

    render(
      <FluentProvider theme={webLightTheme}>
        <SettingsPage />
      </FluentProvider>,
    );

    await waitFor(() => expect(settingsGet).toHaveBeenCalled());
    expect(healthCheck).not.toHaveBeenCalled();
    expect(healthRecheck).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
    expect(screen.getByText(/Build flavor: author/i)).toBeInTheDocument();
  });
});
