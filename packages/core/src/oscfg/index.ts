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
export { resourcesToYaml, parseYamlDocument, parseYamlDocumentLossless } from './format';
export {
  canonicalizeRegistryValueType,
  normalizeManifestRegistryTypesInYaml,
  normalizeRegistryKeyPath,
} from './registry-types';
export { sanitizeNamespace, isValidNamespace } from './naming';
export {
  compareDesiredActual,
  normalizePropertiesForCli,
  summarizeCompliance,
} from './compliance';
export type { ComplianceResult, ComplianceStatus, DesiredResource } from './compliance';
export { isTransientOscfgError, runWithBoundedConcurrency, withRetries } from './concurrency';
export type { ConcurrencyOptions, RetryHandle, RetryOptions, TaskResult } from './concurrency';
export {
  saveRegistration,
  saveRegistrationIfAbsent,
  getRegistration,
  getRegistrationSource,
  getRegistrationSnapshot,
  deleteRegistration,
  listRegistrations,
  updateRegistration,
} from './registry';
export type {
  DeleteRegistrationOptions,
  DeleteRegistrationResult,
  ManifestRegistration,
  RegistrationSnapshot,
  RegistrationRecoveryBackup,
} from './registry';
export {
  OSCFG_CLI_VERSION,
  OSCFG_MINIMUM_VERSION,
  REGISTERED_WINDOWS_TYPES,
  REGISTERED_LINUX_TYPES,
  isRegisteredType,
} from './registered-types';
