// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Typed logger for the Electron main process.
 *
 * Wraps `electron-log` (already a runtime dep) behind a narrow named
 * interface so:
 *   - call sites get the same shape they got with `console.*`
 *     (`log.info("...")`, `log.warn("...")`)
 *   - tests can inject a fake logger via `setLogger(fake)`
 *   - we have a single place to add log scoping (`[elevate]`,
 *     `[deploy]`, etc.) without sprinkling string prefixes everywhere
 *
 * Why typed? The audit (typed-logger follow-up) flagged 39 raw
 * `console.*` calls across main + core modules. A central abstraction
 * gives us:
 *   1. Levels: info / warn / error / debug surfaced consistently
 *   2. A consistent attempt to redact obvious secrets (TOKEN/CSC_KEY)
 *      before they hit disk
 *   3. A migration path to electron-log's file transport without
 *      touching call sites again
 *
 * Renderer code should NOT import this module — Node-only deps
 * (electron-log) will break the renderer bundle. Use the renderer
 * counterpart at `apps/desktop/src/lib/log.ts` instead.
 */

export interface Logger {
  info: (message: string, ...rest: unknown[]) => void;
  warn: (message: string, ...rest: unknown[]) => void;
  error: (message: string, ...rest: unknown[]) => void;
  debug: (message: string, ...rest: unknown[]) => void;
}

/**
 * Patterns that we redact from log messages before emitting them.
 * Best-effort — a determined caller can still leak secrets by
 * stringifying them manually. The intent is to catch the common
 * accidental cases (env-var-style assignments).
 */
const REDACT_PATTERNS: ReadonlyArray<RegExp> = [
  // Match KEY=value or KEY = "value" — both unquoted and quoted forms,
  // including surrounding double quotes if present. The capture group
  // preserves the `KEY=` (or `KEY = `) prefix; the right-hand side is
  // replaced wholesale with [REDACTED] so `=` lookups in logs stay
  // visible while the secret value disappears.
  /(CSC_KEY_PASSWORD\s*=\s*)("[^"]*"|[^\s"]+)/gi,
  /(GH_TOKEN\s*=\s*)("[^"]*"|[^\s"]+)/gi,
  /(GITHUB_TOKEN\s*=\s*)("[^"]*"|[^\s"]+)/gi,
  /(WIN_CSC_KEY_PASSWORD\s*=\s*)("[^"]*"|[^\s"]+)/gi,
  /(WIN_CSC_LINK_BASE64\s*=\s*)("[^"]*"|[^\s"]+)/gi,
  // v0.3.0 (#3): runtime secret patterns. The CI-build secrets above
  // catch our internal release pipeline; these add the credential
  // shapes that customer environments leak when a fetch error /
  // stack trace makes its way into our logs.
  // Authorization: Bearer <jwt-or-opaque>
  /(Authorization:\s*Bearer\s+)(\S+)/gi,
  // Azure-style service principal secrets / tenant IDs (UUIDs).
  /(AZURE_CLIENT_SECRET\s*[=:]\s*)("[^"]*"|[^\s"]+)/gi,
  /(AZURE_CLIENT_ID\s*[=:]\s*)("[^"]*"|[^\s"]+)/gi,
  /(AZURE_TENANT_ID\s*[=:]\s*)("[^"]*"|[^\s"]+)/gi,
  // Azure SAS URLs (?sv=…&sig=…) and other URL-embedded credentials.
  // Capture the leading separator + key=, then nuke the value up to
  // the next & or whitespace.
  /([?&](?:sig|signature|token|key|password|secret|access_token|id_token)=)([^&\s"']+)/gi,
  // Generic `password=`, `secret=`, `api_key=`, `apikey=` in form-data
  // and connection-string-style configs. Capture the prefix
  // (including separator) so $1 keeps the readable key + `=`.
  /(\b(?:password|secret|api[_-]?key)\s*[=:]\s*)("[^"]*"|[^\s"',;]+)/gi,
];

export function redact(message: string): string {
  let out = message;
  for (const re of REDACT_PATTERNS) {
    out = out.replace(re, '$1[REDACTED]');
  }
  return out;
}

function defaultMainLogger(): Logger {
  // Lazy require so unit tests can run without pulling in electron-log
  // (which expects to live inside Electron's process tree).
  let electronLog: Logger | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    electronLog = require('electron-log') as Logger;
  } catch {
    electronLog = null;
  }
  if (electronLog) {
    return {
      info: (m, ...r) => electronLog!.info(redact(String(m)), ...r),
      warn: (m, ...r) => electronLog!.warn(redact(String(m)), ...r),
      error: (m, ...r) => electronLog!.error(redact(String(m)), ...r),
      debug: (m, ...r) => electronLog!.debug(redact(String(m)), ...r),
    };
  }
  // Pure-fallback when electron-log can't load (tests, scripts).
  return {
    info: (m, ...r) => console.info(redact(String(m)), ...r),
    warn: (m, ...r) => console.warn(redact(String(m)), ...r),
    error: (m, ...r) => console.error(redact(String(m)), ...r),
    debug: (m, ...r) => console.debug(redact(String(m)), ...r),
  };
}

let active: Logger = defaultMainLogger();

/**
 * Replace the active logger. Tests use this to capture log output;
 * production code should not call it.
 */
export function setLogger(next: Logger): void {
  active = next;
}

/** Reset to the default (electron-log-backed) logger. */
export function resetLogger(): void {
  active = defaultMainLogger();
}

export const log: Logger = {
  info: (m, ...r) => active.info(m, ...r),
  warn: (m, ...r) => active.warn(m, ...r),
  error: (m, ...r) => active.error(m, ...r),
  debug: (m, ...r) => active.debug(m, ...r),
};

/**
 * Convenience: create a scoped logger that prefixes every message with
 * `[scope] `. Useful for module-level loggers so individual call sites
 * don't have to keep repeating the prefix manually.
 *
 * Example:
 *   const log = scoped('elevate');
 *   log.info('xhost invocation threw'); // logs "[elevate] xhost ..."
 */
export function scoped(scope: string): Logger {
  const prefix = `[${scope}] `;
  return {
    info: (m, ...r) => log.info(prefix + String(m), ...r),
    warn: (m, ...r) => log.warn(prefix + String(m), ...r),
    error: (m, ...r) => log.error(prefix + String(m), ...r),
    debug: (m, ...r) => log.debug(prefix + String(m), ...r),
  };
}
