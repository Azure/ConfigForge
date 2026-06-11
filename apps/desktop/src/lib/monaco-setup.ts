// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * v0.1.0 hot-fix — bundle Monaco locally instead of CDN.
 *
 * `@monaco-editor/react`'s default loader fetches Monaco from
 * `https://cdn.jsdelivr.net/npm/monaco-editor@<version>/min/vs`.
 * In a packaged Electron app with our strict CSP
 * (`script-src 'self'`), that fetch is blocked and the editor
 * spinner runs forever.
 *
 * Calling `loader.config({ monaco })` once before any
 * `<MonacoEditor>` mount tells `@monaco-editor/react` to use the
 * bundled `monaco-editor` package directly — no CDN, no CSP
 * conflict, no hang.
 *
 * Trade-off: bundling Monaco adds ~3 MB raw (~600 KB gzipped). To
 * keep that weight off the cold-start path we lazy-load the entire
 * monaco-editor module from inside `setupMonaco()` so it lands in a
 * separate Rollup chunk that's only fetched when the manifest
 * editor route is opened.
 *
 * Monaco web workers (used for syntax-token analysis) are NOT
 * configured here — that requires `vite-plugin-monaco-editor` or
 * a custom `self.MonacoEnvironment`. For our YAML/JSON manifests
 * (typically <50 KB) the no-worker path is fast enough; revisit
 * if profiling shows main-thread stalls during editing.
 *
 * `setupMonaco()` is called from the lazy-loader in
 * `manifest-editor.tsx` (in parallel with the
 * `@monaco-editor/react` import) so the loader is configured
 * before `<MonacoEditor>` first asks for it.
 */

let setupPromise: Promise<void> | null = null;

/**
 * Lazily load `monaco-editor` and wire it into `@monaco-editor/react`'s
 * loader. Memoized — repeated calls return the same in-flight or
 * resolved promise. Skipped in Vitest's JSDOM env (component tests
 * assert on Suspense fallback, never the real editor).
 */
export function setupMonaco(): Promise<void> {
  if (setupPromise) return setupPromise;

  if (typeof window === 'undefined' || 'vitest' in (globalThis as Record<string, unknown>)) {
    setupPromise = Promise.resolve();
    return setupPromise;
  }

  setupPromise = (async () => {
    const [{ loader }, monaco] = await Promise.all([
      import('@monaco-editor/react'),
      import('monaco-editor'),
    ]);
    loader.config({ monaco });
  })();

  return setupPromise;
}
