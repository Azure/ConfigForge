// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Browser-safe CIS readiness contract shared by renderer surfaces.
 *
 * Detection is not the same as usability:
 * - XCCDF requires its OVAL companion.
 * - Azure Policy JSON requires at least one parsed rule.
 * - Legacy JSON requires both valid global mappings and at least one
 *   per-OS rule catalog.
 */
export interface CisReadinessStatus {
  available?: boolean;
  legacyMappingsLoaded?: boolean;
  legacyRuleCatalogCount?: number;
  schemaError?: string | null;
  source?: "json" | "xccdf" | "both";
  files?: Array<{ name: string; present: boolean }>;
  xccdfFiles?: Array<{ hasOval: boolean }>;
  azurePolicyCisFiles?: Array<{ ruleCount: number }>;
}

export interface CisReadiness {
  detected: boolean;
  partial: boolean;
  usable: boolean;
}

export function getCisReadiness(status: CisReadinessStatus | null): CisReadiness {
  if (!status) return { detected: false, partial: false, usable: false };

  const mappingsPresent = status.legacyMappingsLoaded === true;
  const ruleCatalogPresent = (status.legacyRuleCatalogCount ?? 0) > 0;
  const legacyDetected =
    mappingsPresent ||
    ruleCatalogPresent ||
    status.source === "json" ||
    status.source === "both";

  const usability = [
    ...(status.xccdfFiles ?? []).map((catalog) => catalog.hasOval),
    ...(status.azurePolicyCisFiles ?? []).map((catalog) => catalog.ruleCount > 0),
    ...(legacyDetected ? [mappingsPresent && ruleCatalogPresent] : []),
  ];

  // Be conservative when an older/partial status contract claims available
  // without enough metadata to prove which ingestion path is usable.
  if (usability.length === 0 && status.available) usability.push(false);

  const usableCount = usability.filter(Boolean).length;
  return {
    detected: usability.length > 0,
    partial: usableCount > 0 && usableCount < usability.length,
    usable: usableCount > 0,
  };
}
