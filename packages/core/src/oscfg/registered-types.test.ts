// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect } from 'vitest';
import { isRegisteredType, REGISTERED_WINDOWS_TYPES, REGISTERED_LINUX_TYPES } from './registered-types';

describe('isRegisteredType', () => {
  it('recognizes Windows/CSP on win32', () => {
    expect(isRegisteredType('Microsoft.Windows/CSP', 'win32')).toBe(true);
  });

  it('recognizes Windows/Registry on win32', () => {
    expect(isRegisteredType('Microsoft.Windows/Registry', 'win32')).toBe(true);
  });

  it('does not recognize Windows/CSP on linux', () => {
    expect(isRegisteredType('Microsoft.Windows/CSP', 'linux')).toBe(false);
  });

  it('recognizes Linux/FilePermission on linux', () => {
    expect(isRegisteredType('Linux/FilePermission', 'linux')).toBe(true);
  });

  it('does not recognize Linux/FilePermission on win32', () => {
    expect(isRegisteredType('Linux/FilePermission', 'win32')).toBe(false);
  });

  it('recognizes cross-platform types on both platforms', () => {
    const crossPlatform = ['Microsoft.OSConfig/Test', 'Microsoft.OSConfig/Group', 'Microsoft.OSConfig/File'];
    for (const type of crossPlatform) {
      expect(isRegisteredType(type, 'win32')).toBe(true);
      expect(isRegisteredType(type, 'linux')).toBe(true);
    }
  });

  it('rejects a completely unknown type', () => {
    expect(isRegisteredType('Fake/Type', 'win32')).toBe(false);
    expect(isRegisteredType('Fake/Type', 'linux')).toBe(false);
  });
});

describe('type lists', () => {
  it('Windows types include all expected baseline types', () => {
    expect(REGISTERED_WINDOWS_TYPES).toContain('Microsoft.Windows/AuditPolicy');
    expect(REGISTERED_WINDOWS_TYPES).toContain('Microsoft.Windows/AccountPolicy');
    expect(REGISTERED_WINDOWS_TYPES).toContain('Microsoft.Windows/UserRightsAssignment');
  });

  it('Linux types include all expected baseline types', () => {
    expect(REGISTERED_LINUX_TYPES).toContain('Linux/KernelModule');
    expect(REGISTERED_LINUX_TYPES).toContain('Linux/User');
  });
});
