// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure handler for `cfs:drift:list` and `GET/POST/DELETE /api/drift`.
 *
 * The legacy PowerShell Drift Control API has no equivalent in the
 * oscfg CLI. This handler returns a structured 501 envelope so old UI
 * code degrades cleanly to the manifest-based audit flow.
 */
import type { IpcErrorEnvelope } from './contract';

export function getDriftUnavailable(): IpcErrorEnvelope {
  return {
    ok: false,
    status: 501,
    error:
      'Drift Control API is not available in the unified CLI-based app. Use the Audit feature to check manifest compliance.',
  };
}
