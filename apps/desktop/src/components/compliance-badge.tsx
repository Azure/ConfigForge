// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import {
  CheckmarkCircleRegular,
  DismissCircleRegular,
  WarningRegular,
  QuestionCircleRegular,
} from "@fluentui/react-icons";

type ComplianceStatus = "compliant" | "noncompliant" | "indeterminate" | "error" | "unknown";

interface ComplianceBadgeProps {
  status: ComplianceStatus;
  reason?: string;
}

// H3 fix — every status used `text-{color}-400` only, which on a white
// surface lands at ~2.5:1 contrast and fails WCAG AA. Switched to paired
// light/dark text classes so badges remain legible on both themes while
// preserving the tinted background pill aesthetic.
const config: Record<
  ComplianceStatus,
  { label: string; icon: typeof CheckmarkCircleRegular; className: string }
> = {
  compliant: {
    label: "Compliant",
    icon: CheckmarkCircleRegular,
    className:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  },
  noncompliant: {
    label: "Non-compliant",
    icon: DismissCircleRegular,
    className:
      "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  },
  indeterminate: {
    label: "Could not read",
    icon: WarningRegular,
    className:
      "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  },
  error: {
    label: "Error",
    icon: WarningRegular,
    className:
      "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30",
  },
  unknown: {
    label: "Unknown",
    icon: QuestionCircleRegular,
    className:
      "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30",
  },
};

export function ComplianceBadge({ status, reason }: ComplianceBadgeProps) {
  const { label, icon: Icon, className } = config[status];

  return (
    <span className="group relative inline-flex">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${className}`}
      >
        <Icon size={14} />
        {label}
      </span>

      {reason && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-800 px-3 py-1.5 text-xs text-slate-200 opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
        >
          {reason}
          <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
        </span>
      )}
    </span>
  );
}
