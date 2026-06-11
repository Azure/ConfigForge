// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useCallback, useEffect, useState } from 'react';
import { safeCfs } from '../lib/cfs';
import type { HealthStatus } from '@configforge/core/handlers';

/**
 * State returned by `useCliPresence()`.
 *
 * Consumers use `installed` for the binary go/no-go decision and
 * `loading` for first-paint state (don't render the install modal
 * while we're still checking, it flashes).
 */
export interface CliPresence {
  /** True iff the OSConfig CLI was found by the last health probe. */
  installed: boolean;
  /** Resolved CLI version string (e.g. `oscfg 1.3.9-preview11`), or `''`. */
  version: string;
  /** True while the initial probe is in-flight. */
  loading: boolean;
  /** True if the last probe errored (IPC unreachable, etc.). */
  error: boolean;
  /** Full health snapshot for callers that need more detail. */
  health: HealthStatus | null;
  /**
   * Force a re-probe (clears the 60s server-side cache). Use this
   * from the "I've already installed it, recheck" button after a
   * user installs OSConfig. Returns the new presence state so the
   * caller can act on it immediately.
   */
  recheck: () => Promise<CliPresence>;
}

interface InternalState {
  installed: boolean;
  version: string;
  loading: boolean;
  error: boolean;
  health: HealthStatus | null;
}

const initialInternal: InternalState = {
  installed: false,
  version: '',
  loading: true,
  error: false,
  health: null,
};

function toCliPresence(s: InternalState, recheck: CliPresence['recheck']): CliPresence {
  return { ...s, recheck };
}

/**
 * Renderer-side hook for CLI install status.
 *
 * Wraps `cfs.health.check()` (cached, fast) and `cfs.health.recheck()`
 * (forces a probe). Polls every 60s so a long-running session picks
 * up a CLI install that happened outside the app.
 *
 * Pattern for CLI-gated actions:
 *
 *   const { installed, recheck } = useCliPresence();
 *   const onDeploy = async () => {
 *     if (!installed) {
 *       openCliRequiredModal({ onRetry: recheck });
 *       return;
 *     }
 *     await cfs.deploy.run({ ... });
 *   };
 */
export function useCliPresence(): CliPresence {
  const [state, setState] = useState<InternalState>(initialInternal);

  // recheck() must be stable across renders. Keep `apply` pure (no
  // closure over state) so recheck doesn't change identity when
  // state updates, otherwise the 60s-poll effect would re-fire
  // every probe and we'd spin a render loop.
  const apply = useCallback((h: HealthStatus | null, errored: boolean): InternalState => {
    const next: InternalState = {
      installed: h?.installed ?? false,
      version: h?.version ?? '',
      loading: false,
      error: errored,
      health: h,
    };
    setState(next);
    return next;
  }, []);

  const recheck = useCallback(async (): Promise<CliPresence> => {
    // v0.2.21: mac-author flavor doesn't expose `cfs.health`; treat
    // recheck as a no-op rather than letting the TypeError propagate.
    const healthApi = safeCfs('health');
    if (!healthApi) {
      const next = apply(null, false);
      return toCliPresence(next, recheck);
    }
    try {
      const h = await healthApi.recheck();
      const next = apply(h, false);
      return toCliPresence(next, recheck);
    } catch {
      const next = apply(null, true);
      return toCliPresence(next, recheck);
    }
  }, [apply]);

  // Initial check + 60s poll.
  useEffect(() => {
    let cancelled = false;

    async function probe(): Promise<void> {
      // v0.2.21: on the mac-author flavor, `cfs.health` is not
      // exposed via preload (the deploy/elevation/health namespaces
      // are intentionally absent for editor-only builds). Without a
      // guard, calling `cfs.health.check()` throws a TypeError that
      // gets swallowed by the catch below, permanently pinning the
      // CLI presence pill to amber even though there's no CLI flow
      // on that flavor at all. Use `safeCfs` so the probe is a
      // graceful no-op when the namespace isn't present.
      const healthApi = safeCfs('health');
      if (!healthApi) {
        if (!cancelled) apply(null, false);
        return;
      }
      try {
        const h = await healthApi.check();
        if (!cancelled) apply(h, false);
      } catch {
        if (!cancelled) apply(null, true);
      }
    }

    void probe();
    const id = setInterval(probe, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [apply]);

  return toCliPresence(state, recheck);
}
