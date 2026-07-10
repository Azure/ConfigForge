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
  Status?: string;
  Platform?: string;
  Resources?: OscResource[];
  /** True when the registration has a recorded successful deployment. */
  Deployed?: boolean;
  /** ISO timestamp of the most recent successful deployment. */
  LastAppliedAt?: string | null;
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
