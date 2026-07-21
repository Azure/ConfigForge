// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Authoritative list of resource types registered in the bundled `oscfg`
 * CLI at the time of this repo snapshot. Derived from live probing of
 * oscfg 1.3.8-preview18 on Windows (scripts/probe-types.ps1):
 *
 *   oscfg exec resource --mode list --type <TY>
 *
 * - Types that return exit 0 (even with "LIST operation not implemented"
 *   warning) are considered registered.
 * - Types that return "Unsupported resource type" are not yet registered.
 *
 * The baseline catalog and manifest-editor reference additional aspirational
 * types (e.g., `Microsoft.Windows/AccountPolicy`) that are expected to land
 * in future CLI builds — they are shown in the UI but flagged with a
 * "may not apply on this CLI version" warning.
 *
 * Update this list when the bundled `oscfg` binary is upgraded.
 */

export const OSCFG_CLI_VERSION = '1.3.9-preview11';
export const OSCFG_MINIMUM_VERSION = '1.3.9';

export const REGISTERED_WINDOWS_TYPES = [
  'Microsoft.Windows/CSP',
  'Microsoft.Windows/Registry',
  'Microsoft.Windows/AuditPolicy',
  'Microsoft.Windows/AccountPolicy',
  'Microsoft.Windows/UserRightsAssignment',
  'Microsoft.OSConfig/Test',
  'Microsoft.OSConfig/Group',
  'Microsoft.OSConfig/File',
  'Microsoft.OSConfig/FileLine',
  'Microsoft.OSConfig/DeviceInfo',
  'Microsoft.OSConfig/Firmware',
] as const;

export const REGISTERED_LINUX_TYPES = [
  'Microsoft.OSConfig/File',
  'Microsoft.OSConfig/FileLine',
  'Microsoft.OSConfig/Test',
  'Microsoft.OSConfig/Group',
  'Microsoft.OSConfig/DeviceInfo',
  'Microsoft.OSConfig/Firmware',
  'Linux/FilePermission',
  'Linux/KernelModule',
  'Linux/User',
] as const;

export type RegisteredWindowsType = (typeof REGISTERED_WINDOWS_TYPES)[number];

export function isRegisteredType(
  type: string,
  platform: 'win32' | 'linux',
): boolean {
  const set = platform === 'win32' ? REGISTERED_WINDOWS_TYPES : REGISTERED_LINUX_TYPES;
  return (set as readonly string[]).includes(type);
}
