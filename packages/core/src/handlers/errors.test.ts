// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Unit tests for `errors.ts` — covers the `code` field on HandlerError,
 * the `cliRequiredError()` factory, and the `isCliMissingMessage()`
 * substring detector. These three pieces are the spine of Phase B's
 * bring-your-own-CLI contract: every CLI-gated handler relies on
 * them to distinguish "user hasn't installed OSConfig" from generic
 * failure modes.
 */
import { describe, expect, it } from 'vitest';
import {
  HandlerError,
  cliRequiredError,
  isCliMissingMessage,
  isHandlerError,
} from './errors';

describe('HandlerError code field', () => {
  it('defaults to undefined when not provided', () => {
    const err = new HandlerError(500, 'oops');
    expect(err.code).toBeUndefined();
  });

  it('preserves code when provided', () => {
    const err = new HandlerError(412, 'install required', { code: 'CLI_REQUIRED' });
    expect(err.code).toBe('CLI_REQUIRED');
  });

  it('is still detected by isHandlerError type guard', () => {
    const err = new HandlerError(412, 'install required', { code: 'CLI_REQUIRED' });
    expect(isHandlerError(err)).toBe(true);
  });
});

describe('cliRequiredError', () => {
  it('returns a HandlerError with status 412 and code CLI_REQUIRED', () => {
    const err = cliRequiredError();
    expect(err).toBeInstanceOf(HandlerError);
    expect(err.status).toBe(412);
    expect(err.code).toBe('CLI_REQUIRED');
  });

  it('uses a sensible default message when no detail is provided', () => {
    const err = cliRequiredError();
    expect(err.message).toContain('OSConfig CLI is required');
  });

  it('appends the detail to the default message when provided', () => {
    const err = cliRequiredError('Deploy needs the CLI.');
    expect(err.message).toContain('OSConfig CLI is required');
    expect(err.message).toContain('Deploy needs the CLI.');
  });

  it('is throwable and re-caught with status + code intact', () => {
    try {
      throw cliRequiredError('audit');
    } catch (err) {
      expect(isHandlerError(err)).toBe(true);
      if (isHandlerError(err)) {
        expect(err.status).toBe(412);
        expect(err.code).toBe('CLI_REQUIRED');
      }
    }
  });
});

describe('isCliMissingMessage', () => {
  it('returns false for null / undefined', () => {
    expect(isCliMissingMessage(null)).toBe(false);
    expect(isCliMissingMessage(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isCliMissingMessage('')).toBe(false);
  });

  it('returns true for the canonical CLI-not-found message from resolveOscfgBinary (v0.2.0+)', () => {
    const raw =
      'OSConfig CLI not found. Looked at: /usr/bin/oscfg. Install OSConfig — see INSTALL.md at the repo root or visit https://github.com/microsoft/osconfig.';
    expect(isCliMissingMessage(raw)).toBe(true);
  });

  it('returns true for the legacy "oscfg binary not found" phrasing (rollback resilience)', () => {
    const raw =
      'oscfg binary not found. Looked at: /usr/bin/oscfg. Install the CLI or place the binary in resources/oscfg/linux-x64/oscfg.';
    expect(isCliMissingMessage(raw)).toBe(true);
  });

  it('returns true when wrapped by runOscfg child.on(error) handler', () => {
    expect(isCliMissingMessage('Failed to launch oscfg: ENOENT')).toBe(true);
  });

  it('returns false for unrelated oscfg errors (e.g. permission denied on apply)', () => {
    const raw =
      'oscfg requires Administrator privileges on Windows (the CLI opens a log file in a protected directory on startup).';
    expect(isCliMissingMessage(raw)).toBe(false);
  });

  it('returns false for substring lookalikes that are not CLI-missing failures', () => {
    expect(isCliMissingMessage('error parsing oscfg output')).toBe(false);
    expect(isCliMissingMessage('Microsoft.OSConfig/CSP returned 0x82F00009')).toBe(false);
  });
});
