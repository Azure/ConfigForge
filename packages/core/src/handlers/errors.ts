// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Structured error class for handler functions in
 * `packages/core/src/handlers/`.
 *
 * Handlers throw `HandlerError` instead of returning error responses
 * directly, so the same handler can be consumed by both Next.js
 * (which wraps into `NextResponse.json(..., { status })`) and Electron
 * IPC (which serializes into `{ ok: false, status, error }`).
 *
 * Use the `status` field as you would an HTTP status code:
 *   - 4xx — caller bug / bad input
 *   - 5xx — server-side problem (oscfg missing, FS error, etc.)
 *
 * The `cause` field is optional; pass the original error if there's
 * one so we don't lose stack traces in the wrapper layers.
 *
 * The `data` field is optional structured context that wrappers should
 * spread into their error response. Useful when an error needs to
 * carry extra fields (e.g. /api/diff/matrix returns `missing` alongside
 * `error` when fewer than 2 manifests are present).
 *
 * The `code` field is an optional machine-readable discriminator the
 * renderer uses to branch on specific failure modes. Defined codes:
 *   - `CLI_REQUIRED`, the OSConfig CLI is not installed. Caller
 *     should open the install modal instead of showing a toast.
 */
export class HandlerError extends Error {
  readonly status: number;
  readonly cause?: unknown;
  readonly data?: Record<string, unknown>;
  readonly code?: string;

  constructor(
    status: number,
    message: string,
    options: { cause?: unknown; data?: Record<string, unknown>; code?: string } = {},
  ) {
    super(message);
    this.name = 'HandlerError';
    this.status = status;
    this.cause = options.cause;
    this.data = options.data;
    this.code = options.code;
  }
}

/**
 * Type guard so wrappers don't accidentally treat a generic Error
 * as a HandlerError.
 */
export function isHandlerError(err: unknown): err is HandlerError {
  return err instanceof HandlerError;
}

/**
 * Convenience builder for the most common "the user hasn't installed
 * the OSConfig CLI" case. Status 412 Precondition Failed.
 *
 * The renderer's `useCliPresence()` hook + `<CliRequiredModal />`
 * trigger on `err.code === 'CLI_REQUIRED'`.
 */
export function cliRequiredError(detail?: string): HandlerError {
  const base = 'OSConfig CLI is required for this action but is not installed.';
  return new HandlerError(412, detail ? `${base} ${detail}` : base, {
    code: 'CLI_REQUIRED',
  });
}

/**
 * Detect whether an `OscfgResult.error` came from `resolveOscfgBinary`
 * failing (binary missing). Used by handlers that wrap `runOscfg` calls
 * so they can throw a `cliRequiredError()` instead of bubbling the raw
 * spawn-failure text up to the user.
 *
 * Keeps the substring match in one place so a future error-text
 * refactor in `binary.ts` is easy to follow.
 */
export function isCliMissingMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  return (
    // Current message from resolveOscfgBinary (v0.2.0+).
    message.includes('OSConfig CLI not found') ||
    // Legacy phrasing — still surfaced for prior failure paths so we
    // keep the detector resilient across rollbacks.
    message.includes('oscfg binary not found') ||
    // Spawn-time failure from runner.ts child.on('error') handler.
    message.includes('Failed to launch oscfg')
  );
}
