// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure handler for `cfs:manifests:status` and
 * `GET /api/manifests/status?name=<ns>`.
 *
 * Audit/status — READ-ONLY. Returns reconstructed YAML of the
 * namespace's current reported resources with compliance embedded.
 * 5-second cache + in-flight dedup so repeat clicks during navigation
 * don't stampede the oscfg CLI.
 */
import {
  getResources,
  getRegistration,
  resourcesToYaml,
  sanitizeNamespace,
} from '../oscfg';
import { createCachedDedup } from './cache';
import { HandlerError } from './errors';

const STATUS_TIMEOUT_MS = 5 * 60 * 1000;
const cacheStore = createCachedDedup<object>(5_000);

export function _clearManifestsStatusCache(): void {
  cacheStore._clear();
}

export async function getManifestStatus(name: string): Promise<object> {
  if (!name) throw new HandlerError(400, 'name query parameter is required');
  const namespace = sanitizeNamespace(name);

  const cached = cacheStore.getCached(namespace);
  if (cached !== null) return cached;

  let promise = cacheStore.getInflight(namespace);
  if (!promise) {
    promise = computeStatus(namespace, name).finally(() => {
      cacheStore.clearInflight(namespace);
    });
    cacheStore.setInflight(namespace, promise);
  }
  const payload = await promise;

  if (!('error' in (payload as Record<string, unknown>))) {
    cacheStore.setCached(namespace, payload);
  }
  return payload;
}

async function computeStatus(namespace: string, name: string): Promise<object> {
  const result = await getResources({ namespace, timeoutMs: STATUS_TIMEOUT_MS });
  if (!result.success) {
    const reg = await getRegistration(namespace);
    if (reg) {
      const stub = [
        `# ${name} is registered but not yet deployed on this host.`,
        `# Reported state will appear here after you run Deploy (enforce).`,
        `# Registered: ${reg.registeredAt}`,
        `# Host platform: ${process.platform}`,
        '',
        `# No resources reported by oscfg for namespace "${namespace}".`,
      ].join('\n');
      return {
        data: stub,
        name,
        resources: [],
        deployed: false,
        cliError: result.error,
      };
    }
    return { error: result.error };
  }
  const resources = result.data ?? [];
  const yaml = [
    `# Reported system configuration for: ${name}`,
    `# Generated: ${new Date().toISOString()}`,
    `# Hostname: ${process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? 'unknown'}`,
    '',
    resourcesToYaml(namespace, resources),
  ].join('\n');
  return { data: yaml, name, resources, deployed: true };
}
