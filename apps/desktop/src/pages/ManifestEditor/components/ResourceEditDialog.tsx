// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Visual-builder per-resource edit modal.
 *
 * Opened from a resource card's Edit button. Renders the same
 * `<ResourcePicker>` form that powers Add Resource, but in EDIT mode:
 *   - skips type-selection grid (auto-locked to the original type)
 *   - pre-populates all fields from the existing resource
 *   - shows a rename "Resource Name" field at the top
 *   - submit button reads "Save changes" and merges into the original
 *
 * The buffer change is sent up via `onSave`; the parent (ManifestContent)
 * splices it back into `resources[i]` and writes the new YAML. The
 * manifest-level Save → rationale flow then captures the change as
 * part of the next save batch.
 */

import { useTranslation } from "react-i18next";
import type { Platform } from "@configforge/core/platform";
import { ResourcePicker } from "../../../components/resource-picker";

interface ResourceDefinition {
  name: string;
  type: string;
  properties: Record<string, unknown>;
  compliance?: { equals: unknown };
}

export interface ResourceEditDialogProps {
  open: boolean;
  resource: Record<string, unknown> | null;
  /** Names of other resources, to enforce uniqueness on rename. */
  otherResourceNames: string[];
  /** Platform narrowing for the picker (matches Add panel). */
  platform: Platform | undefined;
  onCancel: () => void;
  onSave: (updated: Record<string, unknown>) => void;
}

function asResourceDef(r: Record<string, unknown> | null): ResourceDefinition | null {
  if (!r) return null;
  const name = typeof r.name === "string" ? r.name : typeof r.Name === "string" ? r.Name : "Setting";
  const type = typeof r.type === "string" ? r.type : typeof r.Type === "string" ? r.Type : "";
  const properties = (r.properties && typeof r.properties === "object" && !Array.isArray(r.properties))
    ? (r.properties as Record<string, unknown>)
    : {};
  const complianceRaw = r.compliance;
  let compliance: ResourceDefinition["compliance"];
  if (complianceRaw && typeof complianceRaw === "object" && "equals" in complianceRaw) {
    compliance = { equals: (complianceRaw as { equals: unknown }).equals };
  }
  return { name, type, properties, compliance };
}

export function ResourceEditDialog({
  open,
  resource,
  otherResourceNames,
  platform,
  onCancel,
  onSave,
}: ResourceEditDialogProps) {
  const { t } = useTranslation("manifest-editor");
  if (!open || !resource) return null;
  const initial = asResourceDef(resource);
  if (!initial) return null;

  const handlePickerSelect = (updated: ResourceDefinition) => {
    // Enforce unique name (compared against everything except the
    // resource being edited).
    if (otherResourceNames.includes(updated.name)) {
      // The picker doesn't render an error surface, so we silently
      // skip the save and let the parent re-open / user retries.
      // Practical UX: this is a rare collision; we just no-op rather
      // than mangle the name. Future improvement: pass a validation
      // callback into the picker.
      // eslint-disable-next-line no-console
      console.warn(`[ResourceEditDialog] Name "${updated.name}" already in use, skipping save.`);
      return;
    }
    onSave(updated as unknown as Record<string, unknown>);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="resource-edit-title"
      onClick={onCancel}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700">
          <h2
            id="resource-edit-title"
            className="text-lg font-semibold text-slate-900 dark:text-white"
          >
            {t("resourceEdit.title")}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            aria-label={t("resourceEdit.cancelAria")}
          >
            ✕
          </button>
        </div>
        <div className="px-6 py-4">
          <ResourcePicker
            platform={platform}
            initialResource={initial}
            onSelect={handlePickerSelect}
            onCancel={onCancel}
          />
        </div>
      </div>
    </div>
  );
}
