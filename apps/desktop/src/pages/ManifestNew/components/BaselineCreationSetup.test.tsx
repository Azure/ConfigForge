// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { getI18n } from "../../../locales";
import { BaselineCreationSetup, type BaselineCreationMethod } from "./BaselineCreationSetup";

const FILE_CASES: Array<{
  method: BaselineCreationMethod;
  accept: string;
  filename: string;
  type: string;
}> = [
  {
    method: "file",
    accept: ".osc.yaml",
    filename: "baseline.yaml",
    type: "text/yaml",
  },
  {
    method: "excel",
    accept: ".xlsx",
    filename: "baseline.xlsx",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
];

beforeEach(async () => {
  await getI18n().changeLanguage("en");
});

describe("BaselineCreationSetup file inputs", () => {
  it.each(FILE_CASES)(
    "resets the $method input so the same file can be selected again",
    ({ method, accept, filename, type }) => {
      const onFilesSelected = vi.fn();
      const { container } = render(
        <FluentProvider theme={webLightTheme}>
          <BaselineCreationSetup
            method={method}
            onMethodChange={vi.fn()}
            name="baseline"
            onNameChange={vi.fn()}
            platform="windows"
            onPlatformChange={vi.fn()}
            uri=""
            onUriChange={vi.fn()}
            importSummary={null}
            importing={false}
            error={null}
            selectedTemplateName={null}
            onBrowseTemplates={vi.fn()}
            onFilesSelected={onFilesSelected}
            canContinue={false}
            continuing={false}
            onContinue={vi.fn()}
            onCancel={vi.fn()}
          />
        </FluentProvider>,
      );
      const input = container.querySelector<HTMLInputElement>(`input[accept*="${accept}"]`);
      expect(input).not.toBeNull();

      const file = new File(["content"], filename, { type });
      const fakePath = `C:\\fakepath\\${filename}`;
      Object.defineProperty(input!, "value", {
        configurable: true,
        writable: true,
        value: fakePath,
      });

      fireEvent.change(input!, { target: { files: [file] } });

      expect(onFilesSelected).toHaveBeenNthCalledWith(1, [file]);
      expect(input).toHaveValue("");

      input!.value = fakePath;
      fireEvent.change(input!, { target: { files: [file] } });

      expect(onFilesSelected).toHaveBeenNthCalledWith(2, [file]);
      expect(input).toHaveValue("");
    },
  );
});
