// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { ManifestEditorState } from "../state/useManifestEditorState";
import { ManifestContent } from "./ManifestContent";

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
    expect(screen.getByRole("cell", { name: "Canonical YAML Setting" })).toBeInTheDocument();
    expect(screen.queryByText("not canonical")).not.toBeInTheDocument();
    expect(screen.queryByText("Hidden_Mof")).not.toBeInTheDocument();
  });
});
