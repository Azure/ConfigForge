// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Shared types for ConfigForge. Shape matches what the UI expects
 * from the API layer (which historically came from the PowerShell OSConfig
 * module and now from the oscfg CLI wrapper).
 */

export interface OscManifest {
  Name: string;
  DisplayName?: string;
  Source: string;
  /** Original registration provenance, preserved for delete/undo recovery. */
  RegistrationSource?: 'user' | 'library' | 'import' | null;
  /** Optional source identifier paired with RegistrationSource. */
  RegistrationSourceId?: string | null;
  Status?: string;
  Platform?: string;
  Resources?: OscResource[];
  /** Number of settings in the registration, including lite list responses. */
  ResourceCount?: number;
  /** Registration-time validation summary used by administrative list views. */
  Validation?: {
    hasSchema: boolean;
    hasEnforcementValues: boolean;
    hasComplianceCriteria: boolean;
    issues: string[];
  } | null;
  /** Compact summary of the latest persisted device audit. */
  Compliance?: OscComplianceSummary | null;
  /** ISO timestamp written whenever the baseline is registered or saved. */
  RegisteredAt?: string | null;
  /** Alias of RegisteredAt for list sorting/filtering semantics. */
  LastModifiedAt?: string | null;
  /** True when the registration has a recorded successful deployment. */
  Deployed?: boolean;
  /** ISO timestamp of the most recent successful deployment. */
  LastAppliedAt?: string | null;
  /** ISO timestamp of the most recent audit, when one exists. */
  LastAuditedAt?: string | null;
}

export interface OscComplianceSummary {
  auditedAt: string;
  total: number;
  compliant: number;
  nonCompliant: number;
  indeterminate: number;
  errors: number;
}

export interface OscResource {
  name: string;
  type: string;
  properties: Record<string, unknown>;
  compliance?: {
    status: string;
    reason: string;
  };
  value?: unknown;
}

export interface OscManifestStatus {
  name: string;
  resources: OscResource[];
}

export interface SettingConfiguration {
  Name: string;
  Description: string;
  DataType: string;
  Default?: unknown;
  Value: unknown;
  Compliance?: string;
  RefreshPeriod?: number;
  ErrorCode?: number;
  ErrorMessage?: string;
}

export interface HealthStatus {
  installed: boolean;
  version: string;
  isAdmin: boolean;
  serverType: string;
  osVersion: string;
  platform?: 'win32' | 'linux' | string;
  binaryPath?: string;
  binarySource?: string;
}
