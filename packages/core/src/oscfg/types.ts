// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Types for the oscfg CLI wrapper. Shapes derived from the CLI README
 * (https://github.com/microsoft/osconfig/tree/main/docs/cli) and refined
 * during discovery.
 */

export interface OscfgResult<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

/** A single namespace entry from `oscfg get namespace --output json` */
export interface OscfgNamespace {
  name: string;
  resourceCount?: number;
  status?: string;
  /** Any additional fields emitted by the CLI. */
  [extra: string]: unknown;
}

/**
 * A single resource entry from `oscfg get resource -n <ns> --output json`.
 * Compliance/status info is expected to be embedded inline (the CLI merges
 * reported state into the resource object). Shape is tolerant of surface
 * changes between CLI versions.
 */
export interface OscfgResource {
  name: string;
  type: string;
  properties: Record<string, unknown>;
  /** Declared vs actual state. */
  compliance?: {
    status?: string;
    reason?: string;
    [extra: string]: unknown;
  };
  /** Reported value for exec-style GET invocations. */
  value?: unknown;
  [extra: string]: unknown;
}

export interface OscfgApplyOptions {
  /** Path to a YAML/JSON manifest file. Mutually exclusive with `content`. */
  file?: string;
  /** Inline YAML/JSON manifest content. New in oscfg 1.3.9 — avoids temp files.
   *  Mutually exclusive with `file`. */
  content?: string;
  /** Optional namespace. Defaults to `default` server-side. */
  namespace?: string;
  /** If true, validate without applying. */
  dryRun?: boolean;
  timeoutMs?: number;
}

export interface OscfgExecOptions {
  mode: 'get' | 'set' | 'remove' | 'list';
  type: string;
  /**
   * Optional resource name. Required for `Microsoft.OSConfig/Test` so the
   * CLI log line can identify which rule failed; optional for direct
   * provider calls like `Microsoft.Windows/Registry`.
   */
  name?: string;
  /**
   * Property map passed to the CLI as a JSON object via `--properties`.
   * Verified empirically on oscfg 1.3.8-preview18: the CLI does NOT parse
   * `k=v,k=v` strings; it expects a JSON blob.
   */
  properties: Record<string, unknown>;
  /** `exec resource` does not take a namespace — kept for backwards compat, ignored. */
  namespace?: string;
  timeoutMs?: number;
}

export type OscfgOutputFormat = 'json' | 'yaml' | 'text';

export interface OscfgGetResourceOptions {
  namespace?: string;
  name?: string;
  output?: OscfgOutputFormat;
  timeoutMs?: number;
}

export interface OscfgDeleteResourceOptions {
  name: string;
  namespace?: string;
  timeoutMs?: number;
}

/** Cached binary info. */
export interface OscfgBinaryInfo {
  path: string;
  version: string;
  platform: NodeJS.Platform;
  /**
   * Where the binary was resolved from:
   *   - 'env'       OSCFG_BIN env var override
   *   - 'bundled'   binary shipped under resources/oscfg/<platform>/
   *   - 'installed' well-known install location (winget MSIX alias,
   *                 WinGet user-scope Links, Program Files, Linux
   *                 /usr or /opt or ~/.local/bin)
   *   - 'path'      discovered on PATH via where/which
   *   - 'msix'      resolved via Get-AppxPackage Microsoft.OSConfig
   *                 (Windows MSIX install discovered without PATH)
   */
  source: 'env' | 'bundled' | 'installed' | 'path' | 'msix';
}
