// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect } from 'vitest';
import { BASELINE_CATALOG } from './baseline-catalog';

/**
 * Regression coverage for the WS2025 standalone-baseline fix.
 *
 * The failing CSP resources in the three WS2025 `.osc.yaml` baselines were
 * converted to dedicated providers, which changed their resource counts and
 * made the upstream `microsoft/osconfig` `githubUrl` values inaccurate (the
 * local manifests no longer match what's published there). This suite locks
 * in the corrected counts and confirms no "Source" link is rendered for
 * these three baselines, while leaving every other catalog entry untouched.
 */
describe('BASELINE_CATALOG — WS2025 standalone-provider fix', () => {
  const ws2025MemberServer = BASELINE_CATALOG.find((b) => b.id === 'ws2025-member-server');
  const ws2025DomainController = BASELINE_CATALOG.find((b) => b.id === 'ws2025-domain-controller');
  const ws2025WorkgroupMember = BASELINE_CATALOG.find((b) => b.id === 'ws2025-workgroup-member');

  it('reports the corrected resource count for ws2025-member-server (320)', () => {
    expect(ws2025MemberServer?.resourceCount).toBe(320);
  });

  it('reports the corrected resource count for ws2025-domain-controller (321)', () => {
    expect(ws2025DomainController?.resourceCount).toBe(321);
  });

  it('reports the corrected resource count for ws2025-workgroup-member (296)', () => {
    expect(ws2025WorkgroupMember?.resourceCount).toBe(296);
  });

  it('has no githubUrl for ws2025-member-server (no Source button)', () => {
    expect(ws2025MemberServer?.githubUrl).toBeUndefined();
  });

  it('has no githubUrl for ws2025-domain-controller (no Source button)', () => {
    expect(ws2025DomainController?.githubUrl).toBeUndefined();
  });

  it('has no githubUrl for ws2025-workgroup-member (no Source button)', () => {
    expect(ws2025WorkgroupMember?.githubUrl).toBeUndefined();
  });

  it('leaves manifestUrl and scenarioName untouched for the three WS2025 baselines', () => {
    expect(ws2025MemberServer?.manifestUrl).toBe('/_baselines/ws2025-member-server.osc.yaml');
    expect(ws2025MemberServer?.scenarioName).toBe('SecurityBaseline/WS2025/MemberServer');

    expect(ws2025DomainController?.manifestUrl).toBe('/_baselines/ws2025-domain-controller.osc.yaml');
    expect(ws2025DomainController?.scenarioName).toBe('SecurityBaseline/WS2025/DomainController');

    expect(ws2025WorkgroupMember?.manifestUrl).toBe('/_baselines/ws2025-workgroup-member.osc.yaml');
    expect(ws2025WorkgroupMember?.scenarioName).toBe('SecurityBaseline/WS2025/WorkgroupMember');
  });

  it('positive control: an untouched baseline still has its githubUrl (Source button preserved)', () => {
    // ws2025-secured-core is a sibling WS2025 baseline that is NOT part of
    // this fix — its upstream link must still render a Source button.
    const securedCore = BASELINE_CATALOG.find((b) => b.id === 'ws2025-secured-core');
    expect(securedCore?.githubUrl).toBe(
      'https://github.com/microsoft/osconfig/blob/main/security/ws2025/secured_core.osc.yaml',
    );
  });
});
