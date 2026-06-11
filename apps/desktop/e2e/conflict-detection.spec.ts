// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * v0.2.16 — Cross-manifest conflict detection, real end-to-end.
 *
 * Drives the BUILT Electron app:
 *   1. Registers two manifests via the live `cfs.manifests.register`
 *      IPC, each setting the same Registry value to a different
 *      enforcement value (the exact scenario the user reported as
 *      "values are different but the conflict detector said nothing").
 *   2. Navigates to /compliance (sidebar label "Validation" since
 *      v0.2.15).
 *   3. Asserts the ConflictDetector renders a `data-testid="conflict-card"`
 *      for the conflicting setting and that both manifest names
 *      appear inside.
 *   4. Cleans up by deleting both manifests in `test.afterAll`.
 *
 * Also pins the Test-wrapper-vs-bare case and the negative case
 * (same setting, same value → no card) because both were silent
 * failure modes under the v0.2.15 implementation.
 */

import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import { createRequire } from 'node:module';

const APP_ROOT = path.resolve(__dirname, '..');
const MAIN_ENTRY = path.join(APP_ROOT, 'dist', 'electron', 'main.js');
const requireFromApp = createRequire(path.join(APP_ROOT, 'package.json'));
const electronExecutablePath = requireFromApp('electron') as string;

// Stable, test-only manifest names — sanitizeNamespace strips non-alnum
// in the backend, so use simple alpha names with a timestamp prefix to
// avoid collisions with a developer's real registrations on the same
// box.
const STAMP = Date.now().toString(36);
const NAME_A = `e2eConflictA${STAMP}`;
const NAME_B = `e2eConflictB${STAMP}`;
const NAME_BARE = `e2eConflictBare${STAMP}`;
const NAME_WRAPPED = `e2eConflictWrapped${STAMP}`;
const NAME_SAME_A = `e2eConflictSameA${STAMP}`;
const NAME_SAME_B = `e2eConflictSameB${STAMP}`;
const ALL_NAMES = [NAME_A, NAME_B, NAME_BARE, NAME_WRAPPED, NAME_SAME_A, NAME_SAME_B];

let app: ElectronApplication;
let win: Page;

test.beforeAll(async () => {
  app = await _electron.launch({
    args: [MAIN_ENTRY],
    cwd: APP_ROOT,
    executablePath: electronExecutablePath,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      LC_ALL: 'en_US.UTF-8',
      LANG: 'en_US.UTF-8',
    },
  });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  // Dismiss the first-run WelcomeDialog. On a clean CI runner with a
  // fresh Electron profile this modal opens and intercepts every
  // click in the sidebar — the smoke and workflows specs use the
  // same pattern. We set the localStorage flag and reload so the
  // dialog never gets the chance to mount.
  await win.evaluate(() => {
    try {
      window.localStorage.setItem('cfs.welcome.dismissedAt', new Date().toISOString());
    } catch {
      // localStorage can be unavailable in restricted sandboxes; the
      // dialog will then appear and the test will fail visibly,
      // which is preferable to a confusing silent skip.
    }
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('h1', { hasText: 'Dashboard' })).toBeVisible();
});

test.afterAll(async () => {
  // Best-effort cleanup. The cfs.manifests.delete IPC returns
  // success/not-found envelopes either way; we don't want a teardown
  // failure to mask a real test failure, so swallow all errors here.
  try {
    await win.evaluate(async (names: string[]) => {
      const cfs = (window as unknown as { cfs: { manifests: { delete: (n: string) => Promise<unknown> } } }).cfs;
      for (const name of names) {
        try {
          await cfs.manifests.delete(name);
        } catch {
          /* ignore */
        }
      }
    }, ALL_NAMES);
  } catch {
    /* ignore */
  }
  await app.close();
});

async function registerManifest(name: string, yamlContent: string): Promise<void> {
  const result = await win.evaluate(
    async ({ n, c }: { n: string; c: string }) => {
      const cfs = (window as unknown as {
        cfs: { manifests: { register: (req: { name: string; content: string }) => Promise<unknown> } };
      }).cfs;
      return await cfs.manifests.register({ name: n, content: c });
    },
    { n: name, c: yamlContent },
  );
  // register returns either a success envelope or an error envelope.
  // Surface failures with the actual server message so e2e debug is
  // tractable instead of "the assertion below failed for no reason".
  const env = result as { ok?: boolean; error?: string };
  if (env && env.ok === false) {
    throw new Error(`register(${name}) failed: ${env.error ?? 'unknown'}`);
  }
}

test.describe('cross-manifest conflict detection — UI surfaces real conflicts', () => {
  test('three real WS2025 role baselines (MS / DC / WG) surface known role-specific drift', async () => {
    // The official Microsoft WS2025 security baselines ship per-role
    // (Member Server, Domain Controller, Workgroup Member). Registering
    // all three should surface the known role-specific deltas — most
    // famously the User Rights differences where Domain Controllers
    // add Enterprise Domain Controllers (`*S-1-5-9`) to certain
    // privileges and exclude Remote Desktop Users from others.
    //
    // This test is the closest a unit test can get to "does the
    // Validation page do what the user expects" — it drives the
    // real Electron app, registers the real shipped baselines,
    // and asserts at least one of the known DC-only deltas surfaces.
    const fs = require('node:fs') as typeof import('node:fs');
    const baseDir = path.resolve(APP_ROOT, '..', '..', 'public', '_baselines');
    const NAME_REAL_MS = `e2eRealMS${STAMP}`;
    const NAME_REAL_DC = `e2eRealDC${STAMP}`;
    const NAME_REAL_WG = `e2eRealWG${STAMP}`;
    ALL_NAMES.push(NAME_REAL_MS, NAME_REAL_DC, NAME_REAL_WG);

    const msYaml = fs.readFileSync(path.join(baseDir, 'ws2025-member-server.osc.yaml'), 'utf-8');
    const dcYaml = fs.readFileSync(path.join(baseDir, 'ws2025-domain-controller.osc.yaml'), 'utf-8');
    const wgYaml = fs.readFileSync(path.join(baseDir, 'ws2025-workgroup-member.osc.yaml'), 'utf-8');

    await registerManifest(NAME_REAL_MS, msYaml);
    await registerManifest(NAME_REAL_DC, dcYaml);
    await registerManifest(NAME_REAL_WG, wgYaml);

    await win.locator('aside').getByRole('link', { name: 'Manifests' }).click();
    await win.locator('aside').getByRole('link', { name: 'Validation' }).click();
    await expect(win.locator('h1', { hasText: /Validation/ })).toBeVisible();

    // Wait for the detector to finish — registering 3×~300-rule
    // manifests means a measurable parse pass on each. 30s is
    // generous for a busy CI runner.
    await expect(
      win.locator('[data-testid="conflict-list"], [data-testid="conflict-none"]').first(),
    ).toBeVisible({ timeout: 30_000 });

    const cards = win.locator('[data-testid="conflict-card"]');

    // 1. AllowLocalLogOn: DC adds Enterprise Domain Controllers
    //    (`*S-1-5-9`) which MS + WG omit. Card must list all three
    //    role-baseline names AND mention the DC-only Enterprise DCs SID.
    const allowLocalLogOnCard = cards.filter({ hasText: /UserRightsAllowLocalLogOn|AllowLocalLogOn/ });
    await expect(allowLocalLogOnCard.first()).toBeVisible({ timeout: 10_000 });
    await expect(allowLocalLogOnCard.first()).toContainText(NAME_REAL_MS);
    await expect(allowLocalLogOnCard.first()).toContainText(NAME_REAL_DC);
    await expect(allowLocalLogOnCard.first()).toContainText(NAME_REAL_WG);
    await expect(allowLocalLogOnCard.first()).toContainText('S-1-5-9');

    // 2. SAMRPCPasswordChangePolicy: known MS=1 / DC=2 / WG=1 drift.
    const samRpcCard = cards.filter({ hasText: /SAMRPCPasswordChangePolicy|SamrChangeUserPasswordApiPolicy/ });
    await expect(samRpcCard.first()).toBeVisible();
    await expect(samRpcCard.first()).toContainText(NAME_REAL_DC);
  });

  test('cross-OS-version pairwise (2019→2022, 2022→2025) — explicit per-pair coverage', async () => {
    // v0.2.18: per-pair end-to-end coverage for OS-version
    // baselines. The algorithm's full behavior — including the
    // negative cases — is pinned in the CLI-level unit tests in
    // `analyzer.test.ts`; this e2e exists to prove the conflict
    // cards actually render on the Validation page when a user
    // registers multi-version baselines on a real install.
    //
    // We assert positive cards only (a known Pass-2 cross-encoding
    // bridge surfaces for the 2022↔2025 pair). Negative cases
    // (2019↔2022 expected zero direct conflicts) are intentionally
    // not asserted at the cards-count level here because this test
    // shares the live Electron app with every other test in the
    // suite — pre-existing registrations contaminate exact counts.
    // Those are covered by the deterministic CLI tests instead.
    const fs = require('node:fs') as typeof import('node:fs');
    const baseDir = path.resolve(APP_ROOT, '..', '..', 'public', '_baselines');
    const NAME_19 = `e2ePair19${STAMP}`;
    const NAME_22 = `e2ePair22${STAMP}`;
    const NAME_25 = `e2ePair25${STAMP}`;
    ALL_NAMES.push(NAME_19, NAME_22, NAME_25);

    const y19 = fs.readFileSync(path.join(baseDir, 'ws2019-domain-member.osc.yaml'), 'utf-8');
    const y22 = fs.readFileSync(path.join(baseDir, 'ws2022-domain-member.osc.yaml'), 'utf-8');
    const y25 = fs.readFileSync(path.join(baseDir, 'ws2025-member-server.osc.yaml'), 'utf-8');

    await registerManifest(NAME_19, y19);
    await registerManifest(NAME_22, y22);
    await registerManifest(NAME_25, y25);

    await win.locator('aside').getByRole('link', { name: 'Manifests' }).click();
    await win.locator('aside').getByRole('link', { name: 'Validation' }).click();
    await expect(win.locator('h1', { hasText: /Validation/ })).toBeVisible();

    await expect(
      win.locator('[data-testid="conflict-list"], [data-testid="conflict-none"]').first(),
    ).toBeVisible({ timeout: 30_000 });

    const cards = win.locator('[data-testid="conflict-card"]');

    // ── Assertion 1: 2022↔2025 cross-encoding bridge — the named
    //                Pass-2 win. WS2022 uses CamelCase rule IDs
    //                ("FirewallDomainProfileInboundConnection") and
    //                WS2025 uses the same. The two encodings DO match
    //                via canonical CSP path; with FirewallDomain* the
    //                rule didn't exist in WS2022 (value=absent) but
    //                does in WS2025 (value=1), so a Pass-1 conflict
    //                surfaces. Card must mention both NAME_22 and NAME_25.
    const firewallCard = cards
      .filter({ hasText: /FirewallDomainProfileInboundConnection/ })
      .filter({ hasText: NAME_22 })
      .filter({ hasText: NAME_25 });
    await expect(firewallCard.first()).toBeVisible({ timeout: 10_000 });

    // ── Assertion 2: WS2025-only logon banner Pass-2 bridge.
    //                MessageTextUserLogonTitle is new in WS2025; it
    //                doesn't exist in WS2022. The conflict card must
    //                mention NAME_22 (value absent) and NAME_25 (value
    //                = the banner string).
    const bannerCard = cards
      .filter({ hasText: /MessageTextUserLogonTitle/ })
      .filter({ hasText: NAME_22 })
      .filter({ hasText: NAME_25 });
    await expect(bannerCard.first()).toBeVisible({ timeout: 5_000 });

    // ── Assertion 3: WS2019↔WS2025 audit rule WAS bridged by
    //                normalization. "Audit Account Lockout" (WS2019,
    //                spaced) normalizes to the same key as
    //                "AuditAccountLockout" (WS2025, CamelCase). Both
    //                set value=2 so no value conflict, but if a
    //                future encoding change broke the cross-name
    //                bridge it'd manifest as one of the 25
    //                known-matched rules dropping out of any
    //                multi-version card. Hard to assert directly
    //                without false-positive risk; the CLI test
    //                `cross-version normalization bridges WS2019
    //                spaced names to WS2025 CamelCase` pins it
    //                deterministically.
    //
    // NOTE: keeping this comment block as documentation; no DOM
    // assertion here.
  });

  test('cross-OS-version 3-way (WS2019 + WS2022 + WS2025) surfaces real drift via Pass-2 name normalization', async () => {
    // v0.2.18: detectConflicts now runs a 2-pass match — canonical
    // identity first (catches same-encoding settings), then cross-
    // encoding by normalized rule name (catches WS2019 bare
    // AuditPolicy/Registry vs WS2025 Microsoft.OSConfig/Test wrapping
    // CSP for the same logical rule, where the canonical IDs are
    // completely different but the human-facing rule names normalize
    // to the same string).
    //
    // For Member Server, the 3-OS-version comparison surfaces ~19
    // role-stable but version-drifted rules (firewall profile
    // inbound defaults flipped, logon banner text added in WS2025,
    // account lockout policy retuned, etc).  We assert the count is
    // at least 10 so a future encoding refactor that silently breaks
    // cross-version matching trips this test.
    const fs = require('node:fs') as typeof import('node:fs');
    const baseDir = path.resolve(APP_ROOT, '..', '..', 'public', '_baselines');
    const NAME_19 = `e2e19MS${STAMP}`;
    const NAME_22 = `e2e22MS${STAMP}`;
    const NAME_25 = `e2e25MS${STAMP}`;
    ALL_NAMES.push(NAME_19, NAME_22, NAME_25);

    const y19 = fs.readFileSync(path.join(baseDir, 'ws2019-domain-member.osc.yaml'), 'utf-8');
    const y22 = fs.readFileSync(path.join(baseDir, 'ws2022-domain-member.osc.yaml'), 'utf-8');
    const y25 = fs.readFileSync(path.join(baseDir, 'ws2025-member-server.osc.yaml'), 'utf-8');

    await registerManifest(NAME_19, y19);
    await registerManifest(NAME_22, y22);
    await registerManifest(NAME_25, y25);

    await win.locator('aside').getByRole('link', { name: 'Manifests' }).click();
    await win.locator('aside').getByRole('link', { name: 'Validation' }).click();
    await expect(win.locator('h1', { hasText: /Validation/ })).toBeVisible();

    // Detector takes longer with several 200–300-rule manifests
    // already on the box from earlier tests. 30s is generous.
    await expect(
      win.locator('[data-testid="conflict-list"], [data-testid="conflict-none"]').first(),
    ).toBeVisible({ timeout: 30_000 });

    const cards = win.locator('[data-testid="conflict-card"]');

    // The full count of cards reflects every Pass-1 + Pass-2 conflict
    // surfaced across all currently-registered manifests (incl. those
    // from earlier tests in this run). We narrow to cards that
    // reference at least one of the three OS-version registrations
    // to get a stable assertion regardless of test order.
    const versionCards = cards.filter({
      hasText: new RegExp(`${NAME_19}|${NAME_22}|${NAME_25}`),
    });
    const count = await versionCards.count();
    expect(count).toBeGreaterThanOrEqual(10);

    // Spot-check a known Pass-2 cross-encoding bridge: WS2025 added
    // a logon-banner "MessageTextUserLogonTitle" that WS2019 and
    // WS2022 don't carry.
    const banner = versionCards.filter({ hasText: /MessageTextUserLogonTitle/ });
    await expect(banner.first()).toBeVisible({ timeout: 5_000 });
  });

  test('two manifests with same registry value+name but different values shows a conflict card', async () => {
    const a = `resources:
  - name: EnableSomething
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM\\\\SOFTWARE\\\\Policies\\\\ConfigForgeE2E
      valueName: EnableSomething
      valueType: Dword
      value: 1
`;
    const b = `resources:
  - name: EnableSomething
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM\\\\SOFTWARE\\\\Policies\\\\ConfigForgeE2E
      valueName: EnableSomething
      valueType: Dword
      value: 0
`;
    await registerManifest(NAME_A, a);
    await registerManifest(NAME_B, b);

    // Navigate to the Validation page (route is still /compliance).
    await win.locator('aside').getByRole('link', { name: 'Validation' }).click();
    await expect(win.locator('h1', { hasText: /Validation/ })).toBeVisible();

    // The ConflictDetector renders only when manifestNames.length >= 2,
    // which is the case now that we just registered two. The detector
    // runs async (fetches each manifest's source YAML and parses) so
    // allow a reasonable timeout. We may share the page with pre-
    // existing conflicts on a developer's box, so filter to the card
    // that mentions BOTH of our test-stamped names.
    const allCards = win.locator('[data-testid="conflict-card"]');
    await expect(allCards.first()).toBeVisible({ timeout: 10_000 });
    const ourCard = allCards
      .filter({ hasText: NAME_A })
      .filter({ hasText: NAME_B });
    await expect(ourCard).toHaveCount(1);
    // Both differing values must appear inside the card.
    await expect(ourCard).toContainText('1');
    await expect(ourCard).toContainText('0');
  });

  test('Test-wrapped vs bare resource for same setting still surfaces the conflict (v0.2.16 fix)', async () => {
    const bare = `resources:
  - name: EnableWrapTest
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM\\\\SOFTWARE\\\\Policies\\\\ConfigForgeE2EWrap
      valueName: EnableWrapTest
      value: 1
`;
    const wrapped = `resources:
  - name: EnableWrapTestGate
    type: Microsoft.OSConfig/Test
    properties:
      resource:
        type: Microsoft.Windows/Registry
        properties:
          keyPath: HKLM\\\\SOFTWARE\\\\Policies\\\\ConfigForgeE2EWrap
          valueName: EnableWrapTest
          value: 0
`;
    await registerManifest(NAME_BARE, bare);
    await registerManifest(NAME_WRAPPED, wrapped);

    // Refresh the Validation page so the ConflictDetector re-fetches
    // with the newly-registered manifests visible.
    await win.locator('aside').getByRole('link', { name: 'Manifests' }).click();
    await win.locator('aside').getByRole('link', { name: 'Validation' }).click();
    await expect(win.locator('h1', { hasText: /Validation/ })).toBeVisible();

    // At least one conflict card must mention both bare + wrapped.
    // We can't assume only one card given the previous test
    // registered conflicts too, so iterate.
    const cards = win.locator('[data-testid="conflict-card"]');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });

    const matchingCard = cards.filter({ hasText: NAME_BARE }).filter({ hasText: NAME_WRAPPED });
    await expect(matchingCard).toHaveCount(1);
  });

  test('two manifests with identical setting+value produce no conflict card', async () => {
    // Use a fresh setting nobody else in this run touches so we can
    // assert the negative case cleanly.
    const same = `resources:
  - name: EnableSameValue
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM\\\\SOFTWARE\\\\Policies\\\\ConfigForgeE2ESame
      valueName: EnableSameValue
      value: 1
`;
    await registerManifest(NAME_SAME_A, same);
    await registerManifest(NAME_SAME_B, same);

    await win.locator('aside').getByRole('link', { name: 'Manifests' }).click();
    await win.locator('aside').getByRole('link', { name: 'Validation' }).click();
    await expect(win.locator('h1', { hasText: /Validation/ })).toBeVisible();

    // Wait for the detector to settle (either renders a card list or
    // the "no conflicts" success bar) so this assertion isn't a race.
    await expect(
      win.locator('[data-testid="conflict-list"], [data-testid="conflict-none"]').first(),
    ).toBeVisible({ timeout: 10_000 });

    // No conflict card may reference *both* SAME_A and SAME_B.
    const cards = win.locator('[data-testid="conflict-card"]');
    const sameSettingCard = cards
      .filter({ hasText: NAME_SAME_A })
      .filter({ hasText: NAME_SAME_B });
    await expect(sameSettingCard).toHaveCount(0);
  });
});
