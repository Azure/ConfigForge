// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Auto-dismissing flash message + scheduled-timer tracking for the
 * Manifests page.
 *
 * Owns the v0.1.13 timer-tracking pattern: every auto-dismiss timer
 * is registered in a Set so unmount can clear them all. Without
 * this, navigating away from /manifests within the dismiss window
 * causes "Can't perform a state update on an unmounted component"
 * warnings + leaks the closure for the remaining timeout.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface FlashMessageState {
  flashMessage: string | null;
  setFlashMessage: (msg: string | null) => void;
  /** Schedule a callback for `ms` later; the timer auto-clears on
   * unmount. Use this instead of bare `setTimeout` whenever a
   * callback would call `setState`. */
  scheduleAutoDismiss: (cb: () => void, ms: number) => void;
}

export function useFlashMessage(): FlashMessageState {
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  // v0.1.13 fix — track every auto-dismiss setTimeout so we can clear
  // them on unmount. Previously deployResult / bulkResult / flashMessage
  // each scheduled their own naked setTimeout that would call
  // setState 5-10s later; if the user navigated away (back to /, to
  // /library, etc.) before they fired, React logged "Can't perform a
  // state update on an unmounted component" + leaked the closure for
  // the remaining timeout window.
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const scheduleAutoDismiss = useCallback((cb: () => void, ms: number) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      cb();
    }, ms);
    timersRef.current.add(id);
  }, []);

  // Read flash message from sessionStorage on mount (set elsewhere by
  // a successful save / register / similar).
  useEffect(() => {
    const flash = sessionStorage.getItem("configforge-flash");
    if (flash) {
      setFlashMessage(flash);
      sessionStorage.removeItem("configforge-flash");
      scheduleAutoDismiss(() => setFlashMessage(null), 5000);
    }
  }, [scheduleAutoDismiss]);

  return {
    flashMessage,
    setFlashMessage,
    scheduleAutoDismiss,
  };
}
