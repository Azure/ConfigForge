// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * oscfg CLI wrapper — cross-platform replacement for the Microsoft.OSConfig
 * PowerShell module. See docs/cli/README.md in the osconfig repo.
 */
export * from './types';
export { resolveOscfgBinary, _resetOscfgBinaryCache } from './binary';
export { runOscfg } from './runner';
export { applyManifest } from './apply';
export { getNamespaces, getResources, getResourceByName } from './get';
export { createNamespace, deleteNamespace, deleteResource } from './manage';
export { execResource, serializeProperties } from './exec';
export { resourcesToYaml, parseYamlDocument } from './format';
export { sanitizeNamespace, isValidNamespace } from './naming';
export {
  compareDesiredActual,
  normalizePropertiesForCli,
  normalizeRegistryKeyPath,
  summarizeCompliance,
} from './compliance';
export type { ComplianceResult, ComplianceStatus, DesiredResource } from './compliance';
export {
  isTransientOscfgError,
  runWithBoundedConcurrency,
  withRetries,
} from './concurrency';
export type { ConcurrencyOptions, RetryHandle, RetryOptions, TaskResult } from './concurrency';
export {
  saveRegistration,
  getRegistration,
  getRegistrationSource,
  deleteRegistration,
  listRegistrations,
  updateRegistration,
} from './registry';
export type { ManifestRegistration } from './registry';
export {
  OSCFG_CLI_VERSION,
  REGISTERED_WINDOWS_TYPES,
  REGISTERED_LINUX_TYPES,
  isRegisteredType,
} from './registered-types';
