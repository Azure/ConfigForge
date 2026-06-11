// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * CF-SEC-001 — production navigation guard tests.
 *
 * The previous `startsWith('file://')` allowlist permitted navigation
 * to arbitrary local files. These tests assert the new guard accepts
 * the packaged index.html (with `#/route` fragments) and rejects
 * every other file:// path, http(s) URL, data: URI, and javascript:
 * URI.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildShouldAllowRendererNavigation } from './navigation-guard';

const FAKE_ELECTRON_DIR = path.join(path.sep, 'app', 'dist', 'electron');
const PACKAGED_INDEX = pathToFileURL(
  path.join(FAKE_ELECTRON_DIR, '..', 'index.html'),
).toString();

const guardProd = buildShouldAllowRendererNavigation({
  electronDir: FAKE_ELECTRON_DIR,
  isDev: false,
  devServerUrl: 'http://localhost:5173',
});

const guardDev = buildShouldAllowRendererNavigation({
  electronDir: FAKE_ELECTRON_DIR,
  isDev: true,
  devServerUrl: 'http://localhost:5173',
});

describe('shouldAllowRendererNavigation — prod', () => {
  it('allows navigation to the exact packaged index.html', () => {
    expect(guardProd(PACKAGED_INDEX)).toBe(true);
  });

  it('allows hash routes off the packaged index.html', () => {
    expect(guardProd(`${PACKAGED_INDEX}#/manifests`)).toBe(true);
    expect(guardProd(`${PACKAGED_INDEX}#/settings?ignored`)).toBe(true);
  });

  it('rejects unexpected query strings on the packaged URL', () => {
    expect(guardProd(`${PACKAGED_INDEX}?evil=1`)).toBe(false);
  });

  it('rejects arbitrary file:// paths', () => {
    expect(guardProd('file:///etc/passwd')).toBe(false);
    expect(guardProd('file:///C:/Windows/System32/cmd.exe')).toBe(false);
    expect(guardProd('file://server/share/foo.html')).toBe(false);
  });

  it('rejects http(s) URLs', () => {
    expect(guardProd('https://evil.example/')).toBe(false);
    expect(guardProd('http://localhost:5173/')).toBe(false);
  });

  it('rejects data: / javascript: / unknown schemes', () => {
    expect(guardProd('data:text/html,<script>1</script>')).toBe(false);
    expect(guardProd('javascript:alert(1)')).toBe(false);
    expect(guardProd('chrome://settings')).toBe(false);
  });

  it('allows cfs-blob:// (its handler enforces its own allowlist)', () => {
    expect(guardProd('cfs-blob://audit-pack/some-id?format=pdf')).toBe(true);
    expect(guardProd('cfs-blob://export/some-name?format=yaml')).toBe(true);
  });

  it('rejects empty or non-string inputs', () => {
    expect(guardProd('')).toBe(false);
    expect(guardProd(undefined as unknown as string)).toBe(false);
    expect(guardProd(null as unknown as string)).toBe(false);
  });

  it('rejects file:// URLs that point at a sibling of the packaged index', () => {
    // Same parent directory, different file — must still be rejected.
    const sibling = pathToFileURL(
      path.join(FAKE_ELECTRON_DIR, '..', 'something-else.html'),
    ).toString();
    expect(guardProd(sibling)).toBe(false);
  });
});

describe('shouldAllowRendererNavigation — dev', () => {
  it('allows the configured dev-server origin', () => {
    expect(guardDev('http://localhost:5173/')).toBe(true);
    expect(guardDev('http://localhost:5173/manifests')).toBe(true);
  });

  it('rejects a different dev-server port', () => {
    expect(guardDev('http://localhost:9000/')).toBe(false);
  });

  it('rejects file:// in dev too', () => {
    expect(guardDev('file:///etc/passwd')).toBe(false);
  });

  it('still allows cfs-blob:// in dev', () => {
    expect(guardDev('cfs-blob://audit-pack/abc?format=pdf')).toBe(true);
  });
});
