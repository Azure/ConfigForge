// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { ManifestEditorState } from "../state/useManifestEditorState";
import { ManifestContent } from "./ManifestContent";

vi.mock("../../../components/manifest-editor", () => ({
  ManifestEditor: ({
    value,
    onChange,
    readOnlyMessage,
  }: {
    value: string;
    onChange?: (value: string) => void;
    readOnlyMessage?: string;
  }) => (
    <div>
      <output aria-label="code-value">{value}</output>
      {readOnlyMessage && <span>{readOnlyMessage}</span>}
      {onChange && (
        <button type="button" onClick={() => onChange(`${value}\n# changed`)}>
          Change code
        </button>
      )}
    </div>
  ),
}));

function visualState(): ManifestEditorState {
  const yamlSource = `resources:
  - name: Canonical YAML Setting
    type: Example/Canonical
    properties:
      enabled: true
`;

  return {
    editing: false,
    editedContent: "instance of Hidden_Mof {}",
    setEditedContent: vi.fn(),
    savedContent: '{"resources":[{"name":"not canonical"}]}',
    editView: "editor",
    setEditView: vi.fn(),
    activeFormat: "mof",
    formatLoading: false,
    formatCache: {
      current: {
        yaml: yamlSource,
        json: '{"resources":[{"name":"Canonical YAML Setting"}]}',
        mof: "instance of Hidden_Mof {}",
      },
    },
    handleFormatChange: vi.fn().mockResolvedValue(undefined),
    isEditable: false,
    isReadOnly: true,
    currentDisplayContent: "instance of Hidden_Mof {}",
  } as unknown as ManifestEditorState;
}

describe("ManifestContent read-only Visual mode", () => {
  it("renders canonical cached YAML even when the hidden code format is MOF", () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <ManifestContent
          editorState={visualState()}
          editorPlatform={undefined}
          cisAvailable={false}
          manifestName="sample"
          viewerMode="visual"
          onViewerModeChange={vi.fn()}
        />
      </FluentProvider>,
    );

    expect(screen.getByRole("region", { name: "Visual baseline settings" })).toBeInTheDocument();
    expect(
      screen.getAllByText("Read-only view. Select Edit in the footer to make changes."),
    ).not.toHaveLength(0);
    expect(screen.getByRole("cell", { name: "Canonical YAML Setting" })).toBeInTheDocument();
    expect(screen.queryByText("not canonical")).not.toBeInTheDocument();
    expect(screen.queryByText("Hidden_Mof")).not.toBeInTheDocument();
  });

  it("undoes the most recent Visual spreadsheet edit", async () => {
    const user = userEvent.setup();
    const source = `resources:
  - name: Example setting
    type: Example/Type
    properties:
      path: before
`;
    const setEditedContent = vi.fn();
    const state = {
      ...visualState(),
      editing: true,
      editedContent: source,
      setEditedContent,
      editView: "visual",
      activeFormat: "yaml",
      formatCache: { current: { yaml: source } },
      isEditable: true,
      isReadOnly: false,
      currentDisplayContent: source,
    } as unknown as ManifestEditorState;

    render(
      <FluentProvider theme={webLightTheme}>
        <ManifestContent
          editorState={state}
          editorPlatform={undefined}
          cisAvailable={false}
          manifestName="sample"
          viewerMode="visual"
          onViewerModeChange={vi.fn()}
        />
      </FluentProvider>,
    );

    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Edit Path for Example setting" }),
    );
    const input = screen.getByRole("textbox", {
      name: "Edit Path for Example setting",
    });
    await user.clear(input);
    await user.type(input, "after{Enter}");

    expect(undo).toBeEnabled();
    await user.click(undo);
    await waitFor(() =>
      expect(setEditedContent).toHaveBeenLastCalledWith(source),
    );
  });

  it("undoes a coalesced Code editor change", async () => {
    const user = userEvent.setup();
    const source = "resources: []\n";
    const setEditedContent = vi.fn();
    const state = {
      ...visualState(),
      editing: true,
      editedContent: source,
      setEditedContent,
      editView: "editor",
      activeFormat: "yaml",
      formatCache: { current: { yaml: source } },
      isEditable: true,
      isReadOnly: false,
      currentDisplayContent: source,
    } as unknown as ManifestEditorState;

    render(
      <FluentProvider theme={webLightTheme}>
        <ManifestContent
          editorState={state}
          editorPlatform={undefined}
          cisAvailable={false}
          manifestName="sample"
          viewerMode="code"
          onViewerModeChange={vi.fn()}
        />
      </FluentProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Change code" }));
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).toBeEnabled();
    await user.click(undo);
    expect(setEditedContent).toHaveBeenLastCalledWith(source);
  });

  it("keeps a canonical undo checkpoint when JSON switches to Visual", async () => {
    const user = userEvent.setup();
    const originalYaml = "resources:\n  - name: before\n";
    const editedJson = '{"resources":[{"name":"after"}]}';
    const setEditedContent = vi.fn();
    const state = {
      ...visualState(),
      editing: true,
      editedContent: editedJson,
      setEditedContent,
      savedContent: originalYaml,
      editView: "editor",
      setEditView: vi.fn(),
      activeFormat: "json",
      setActiveFormat: vi.fn(),
      formatCache: {
        current: { yaml: originalYaml, json: '{"resources":[{"name":"before"}]}' },
      },
      isEditable: true,
      isReadOnly: false,
      currentDisplayContent: '{"resources":[{"name":"before"}]}',
    } as unknown as ManifestEditorState;

    render(
      <FluentProvider theme={webLightTheme}>
        <ManifestContent
          editorState={state}
          editorPlatform={undefined}
          cisAvailable={false}
          manifestName="sample"
          viewerMode="code"
          onViewerModeChange={vi.fn()}
        />
      </FluentProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Visual" }));
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).toBeEnabled();
    await user.click(undo);
    expect(setEditedContent).toHaveBeenLastCalledWith(originalYaml);
  });
});
