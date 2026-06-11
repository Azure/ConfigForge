// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { runOscfg } from './runner';
import type { OscfgDeleteResourceOptions, OscfgResult } from './types';

/**
 * Create a new namespace.
 *   oscfg create namespace <name>
 */
export async function createNamespace(
  name: string,
  timeoutMs?: number,
): Promise<OscfgResult<null>> {
  return runOscfg<null>(['create', 'namespace', name], {
    timeoutMs,
    parseJson: false,
  });
}

/**
 * Delete a namespace. Equivalent to old `Remove-OscManifest`.
 *   oscfg delete namespace <name>
 */
export async function deleteNamespace(
  name: string,
  timeoutMs?: number,
): Promise<OscfgResult<null>> {
  return runOscfg<null>(['delete', 'namespace', name], {
    timeoutMs,
    parseJson: false,
  });
}

/**
 * Delete a specific resource from a namespace.
 *   oscfg delete resource <NAME> [-n <NS>]
 *
 * Note: NAME is a positional argument in the current CLI (confirmed against
 * oscfg 1.3.8-preview18), not a `--name` flag.
 */
export async function deleteResource(
  opts: OscfgDeleteResourceOptions,
): Promise<OscfgResult<null>> {
  // `--` separator disambiguates the positional NAME so resources whose names
  // start with `-` (e.g. `-h`) aren't parsed as flags by clap. Same rationale
  // as the matching guard in oscfg/get.ts for `getResources`.
  const args = ['delete', 'resource', '--', opts.name];
  if (opts.namespace) args.push('-n', opts.namespace);
  return runOscfg<null>(args, { timeoutMs: opts.timeoutMs, parseJson: false });
}
