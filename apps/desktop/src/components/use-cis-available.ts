// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Module-level CIS-availability cache + React hook.
 *
 * One in-flight call per page lifetime — every component that needs
 * to know whether CIS is available shares the same Promise. The result
 * is cached for the lifetime of the page (refresh to re-check).
 */

import { useEffect, useState } from "react";
import { getCisReadiness } from "@configforge/core/cis/readiness";
import { cfs } from "../lib/cfs";

let _inflight: Promise<boolean> | null = null;
let _cached: boolean | null = null;

async function fetchCisAvailable(): Promise<boolean> {
  if (_cached !== null) return _cached;
  if (_inflight) return _inflight;
  _inflight = cfs.cis
    .status()
    .then((data) => {
      _cached = getCisReadiness(data).usable;
      return _cached;
    })
    .catch(() => {
      _cached = false;
      return false;
    })
    .finally(() => {
      _inflight = null;
    }) as Promise<boolean>;
  return _inflight;
}

/**
 * Returns `null` while loading, then `true | false`. The undefined-y
 * loading state is significant: callers should NOT render the CIS UI
 * during loading either (avoid a flash of "available" → "unavailable").
 *
 * Side effect: when CIS becomes available, schedules a one-time
 * background warm-up so the first inline lookup doesn't block the
 * main thread on a multi-MB OVAL parse.
 *
 * Warmup is DEFERRED to idle time (requestIdleCallback, fallback to a
 * 1.5s setTimeout). Without this delay the XCCDF/OVAL parse on the
 * main process — `fast-xml-parser` is synchronous and blocks the
 * Electron main thread for ~1s on a 4MB OVAL file — would compete
 * with the active page's IPC traffic (e.g. manifest.get,
 * exportChannel.get, manifest.status fired by useManifestEditorState
 * on the same mount tick). The result was a 400-450ms delay on
 * opening a manifest detail page when CIS data was on disk. The
 * warmup still completes well before the user can click on a
 * resource — typical click-to-CIS-drawer latency exceeds 2s.
 */
let _warmupFired = false;
function scheduleWarmup(): void {
  if (_warmupFired) return;
  _warmupFired = true;
  const fire = () => {
    cfs.cis.warmup?.().catch(() => { /* best-effort */ });
  };
  // 3-second delay is plenty for the page to render before we kick off
  // a 1-second synchronous XML parse on the main process. The first
  // user click on an editor resource typically happens >3s after open.
  setTimeout(fire, 3000);
}

export function useCisAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(_cached);

  useEffect(() => {
    if (_cached !== null) {
      setAvailable(_cached);
      if (_cached) scheduleWarmup();
      return;
    }
    let cancelled = false;
    fetchCisAvailable().then((v) => {
      if (!cancelled) setAvailable(v);
      if (v) scheduleWarmup();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return available;
}

/**
 * Invalidate the module-level CIS-availability cache so the NEXT call
 * to ``useCisAvailable`` (or ``fetchCisAvailable``) re-queries the
 * main process. Called from the CIS Catalog page after the user runs
 * "Re-check catalog" — without this, the renderer would keep
 * returning the boot-time answer even though the main process now
 * sees new files.
 *
 * Also used as a test affordance for unit tests of useCisAvailable.
 */
export function _resetCisAvailableCacheForTests(): void {
  _cached = null;
  _inflight = null;
  _warmupFired = false;
}
