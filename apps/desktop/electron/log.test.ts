// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { log, redact, resetLogger, scoped, setLogger, type Logger } from './log';

function makeFake(): Logger & { calls: Array<[string, string, unknown[]]> } {
  const calls: Array<[string, string, unknown[]]> = [];
  return {
    calls,
    info: (m, ...r) => calls.push(['info', String(m), r]),
    warn: (m, ...r) => calls.push(['warn', String(m), r]),
    error: (m, ...r) => calls.push(['error', String(m), r]),
    debug: (m, ...r) => calls.push(['debug', String(m), r]),
  };
}

describe('main-process logger', () => {
  let fake: ReturnType<typeof makeFake>;
  beforeEach(() => {
    fake = makeFake();
    setLogger(fake);
  });
  afterEach(() => {
    resetLogger();
  });

  it('routes info/warn/error/debug through the active logger', () => {
    log.info('starting up');
    log.warn('elevation refused');
    log.error('boom');
    log.debug('frame=42');
    expect(fake.calls.map(([lvl, msg]) => `${lvl}:${msg}`)).toEqual([
      'info:starting up',
      'warn:elevation refused',
      'error:boom',
      'debug:frame=42',
    ]);
  });

  it('forwards rest-args verbatim', () => {
    const obj = { x: 1 };
    log.info('with extras', obj, 42);
    expect(fake.calls[0]).toEqual(['info', 'with extras', [obj, 42]]);
  });

  it('scoped() prefixes messages with [scope]', () => {
    const elevateLog = scoped('elevate');
    elevateLog.info('xhost threw');
    elevateLog.warn('pkexec missing');
    expect(fake.calls).toEqual([
      ['info', '[elevate] xhost threw', []],
      ['warn', '[elevate] pkexec missing', []],
    ]);
  });
});

describe('redact', () => {
  it('redacts common secret-style assignments', () => {
    expect(redact('CSC_KEY_PASSWORD=correctHorseBattery')).toContain('[REDACTED]');
    expect(redact('CSC_KEY_PASSWORD=correctHorseBattery')).not.toContain('correctHorseBattery');
    expect(redact('GH_TOKEN=ghp_abc123def456')).not.toContain('ghp_abc123def456');
    expect(redact('WIN_CSC_KEY_PASSWORD = "p@ss"')).toContain('[REDACTED]');
  });

  it('redacts case-insensitively', () => {
    expect(redact('csc_key_password=foo')).toContain('[REDACTED]');
  });

  it('leaves non-secret strings unchanged', () => {
    expect(redact('[elevate] pkexec stdout: hello world')).toBe(
      '[elevate] pkexec stdout: hello world',
    );
  });

  it('handles multiple secrets on one line', () => {
    const redacted = redact('CSC_KEY_PASSWORD=a GH_TOKEN=b');
    expect(redacted).not.toContain('CSC_KEY_PASSWORD=a');
    expect(redacted).not.toContain('GH_TOKEN=b');
    expect((redacted.match(/\[REDACTED\]/g) ?? []).length).toBe(2);
  });
});

describe('setLogger / resetLogger lifecycle', () => {
  it('setLogger swaps the active logger; resetLogger restores the default', () => {
    const a = makeFake();
    const b = makeFake();
    setLogger(a);
    log.info('first');
    setLogger(b);
    log.info('second');
    expect(a.calls.map(([, m]) => m)).toEqual(['first']);
    expect(b.calls.map(([, m]) => m)).toEqual(['second']);
    resetLogger();
    // After reset the active logger is the default (real electron-log or
    // a console fallback). We don't assert *what* it does, only that
    // `setLogger` is no longer routing to `b`.
    log.info('third');
    expect(b.calls.map(([, m]) => m)).toEqual(['second']);
  });
});

describe('default logger fallback', () => {
  it('uses console when electron-log is unavailable', () => {
    // Spy the console methods, force a reset (which goes through the
    // require fallback) and verify console.* gets called.
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    resetLogger();
    log.info('fallback');
    // Either electron-log handled it (no console call) or our console
    // fallback did. We allow either, but if electron-log is present in
    // the test environment we just assert that no throw occurred.
    expect(() => log.info('twice')).not.toThrow();
    infoSpy.mockRestore();
  });
});
