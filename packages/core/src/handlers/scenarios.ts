// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure handler for `cfs:scenarios:list` and the deprecated
 * `GET /api/scenarios`.
 *
 * The legacy PowerShell Scenario API has no equivalent in the oscfg
 * CLI, but old UI code may still probe for it. Returning a structured
 * 501 envelope lets the renderer detect "not supported" cleanly.
 */
import type { IpcErrorEnvelope } from './contract';

export function getScenariosUnavailable(): IpcErrorEnvelope {
  return {
    ok: false,
    status: 501,
    error:
      'Scenario API is not available in the unified CLI-based app. Use the Library to deploy pre-built baselines as manifests.',
  };
}
