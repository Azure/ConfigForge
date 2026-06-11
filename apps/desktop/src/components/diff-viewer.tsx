// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.


import { useMemo } from "react";
import { useTranslation } from "react-i18next";

interface DiffViewerProps {
  left: string;
  right: string;
  leftTitle?: string;
  rightTitle?: string;
}

type LineStatus = "same" | "added" | "removed" | "changed";

interface DiffLine {
  left: string | null;
  right: string | null;
  status: LineStatus;
}

function computeDiff(leftText: string, rightText: string): DiffLine[] {
  const leftLines = leftText.split("\n");
  const rightLines = rightText.split("\n");
  const maxLen = Math.max(leftLines.length, rightLines.length);
  const result: DiffLine[] = [];

  for (let i = 0; i < maxLen; i++) {
    const l = i < leftLines.length ? leftLines[i] : null;
    const r = i < rightLines.length ? rightLines[i] : null;

    if (l === null) {
      result.push({ left: null, right: r, status: "added" });
    } else if (r === null) {
      result.push({ left: l, right: null, status: "removed" });
    } else if (l === r) {
      result.push({ left: l, right: r, status: "same" });
    } else {
      result.push({ left: l, right: r, status: "changed" });
    }
  }

  return result;
}

// GitHub-style diff palette: opaque light tints for the meaningful
// cell so plain black text reads cleanly. The "ghost" side (where
// there's nothing to show, e.g. the left half of an added line) gets
// a muted dark fill — text on that side is also muted because the
// real content is on the OTHER side.
const statusBg: Record<LineStatus, { left: string; right: string }> = {
  same: { left: "", right: "" },
  added: { left: "bg-slate-800/60", right: "bg-emerald-200" },
  removed: { left: "bg-red-200", right: "bg-slate-800/60" },
  changed: { left: "bg-amber-100", right: "bg-amber-100" },
};

const statusText: Record<LineStatus, { left: string; right: string }> = {
  same: { left: "text-slate-200", right: "text-slate-200" },
  added: { left: "text-slate-400", right: "text-black" },
  removed: { left: "text-black", right: "text-slate-400" },
  changed: { left: "text-black", right: "text-black" },
};

// Line-number gutter: line numbers sit INSIDE the colored row, so
// they inherit the background. Use a dark grey on the light tinted
// sides for readability, and the original mid-grey on the dark ghost
// / same-line side.
const statusLineNum: Record<LineStatus, { left: string; right: string }> = {
  same: { left: "text-slate-500", right: "text-slate-500" },
  added: { left: "text-slate-500", right: "text-slate-700" },
  removed: { left: "text-slate-700", right: "text-slate-500" },
  changed: { left: "text-slate-700", right: "text-slate-700" },
};

export function DiffViewer({
  left,
  right,
  leftTitle,
  rightTitle,
}: DiffViewerProps) {
  const { t } = useTranslation("diff");
  const diff = useMemo(() => computeDiff(left, right), [left, right]);
  const resolvedLeftTitle = leftTitle ?? t("viewer.before");
  const resolvedRightTitle = rightTitle ?? t("viewer.after");

  return (
    <div className="overflow-hidden rounded-lg border border-slate-700">
      {/* Header */}
      <div className="grid grid-cols-2 border-b border-slate-700 bg-slate-800/60 text-xs font-semibold text-slate-300">
        <div className="border-r border-slate-700 px-4 py-2">{resolvedLeftTitle}</div>
        <div className="px-4 py-2">{resolvedRightTitle}</div>
      </div>

      {/* Lines */}
      <div className="max-h-[600px] overflow-auto font-mono text-xs leading-6">
        {diff.map((line, idx) => (
          <div key={idx} className="grid grid-cols-2">
            {/* Left */}
            <div
              className={`flex border-r border-slate-700/60 ${statusBg[line.status].left}`}
            >
              <span className={`w-10 flex-shrink-0 select-none border-r border-slate-700/40 px-2 text-right ${statusLineNum[line.status].left}`}>
                {line.left !== null ? idx + 1 : ""}
              </span>
              <pre className={`flex-1 overflow-x-auto whitespace-pre px-3 ${statusText[line.status].left}`}>
                {line.left ?? ""}
              </pre>
            </div>

            {/* Right */}
            <div className={`flex ${statusBg[line.status].right}`}>
              <span className={`w-10 flex-shrink-0 select-none border-r border-slate-700/40 px-2 text-right ${statusLineNum[line.status].right}`}>
                {line.right !== null ? idx + 1 : ""}
              </span>
              <pre className={`flex-1 overflow-x-auto whitespace-pre px-3 ${statusText[line.status].right}`}>
                {line.right ?? ""}
              </pre>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
