// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import type { Platform } from '@configforge/core/platform';

export interface BaselineEntry {
  id: string;
  name: string;
  description: string;
  platform: Platform;
  category: 'security-baseline' | 'secured-core' | 'defender' | 'linux-security' | 'feature-scenario' | 'cis-benchmark';
  version: string;
  source: 'github' | 'local';
  manifestUrl?: string;
  csvUrl?: string;
  /**
   * Public upstream source URL (typically a github.com/microsoft/osconfig blob).
   * If unset, no "Source" link is rendered for the baseline (e.g. for
   * project-internal baselines like LAPS/SSH or proprietary content
   * like the Linux Security Baseline).
   */
  githubUrl?: string;
  resourceCount?: number;
  resourceTypes: string[];
  /** If set, this baseline is a built-in OSConfig scenario and should be deployed via Set-OSConfigDesiredConfiguration */
  scenarioName?: string;
  /** Available historical versions for cross-version comparison */
  versions?: { version: string; csvUrl: string }[];
}

export const BASELINE_CATALOG: BaselineEntry[] = [
  {
    id: 'ws2025-member-server',
    name: 'Windows Server 2025 - Member Server',
    description:
      'Comprehensive security baseline for Windows Server 2025 member servers. Over 300 security settings including registry, CSP, account policy, audit policy, and user rights.',
    platform: 'windows',
    category: 'security-baseline',
    version: '2510',
    source: 'local',
    manifestUrl: '/_baselines/ws2025-member-server.osc.yaml',
    resourceCount: 320,
    resourceTypes: ['Microsoft.OSConfig/Test'],
    scenarioName: 'SecurityBaseline/WS2025/MemberServer',
  },
  {
    id: 'ws2025-domain-controller',
    name: 'Windows Server 2025 - Domain Controller',
    description:
      'Security baseline for Windows Server 2025 domain controllers with Active Directory-specific settings.',
    platform: 'windows',
    category: 'security-baseline',
    version: '2510',
    source: 'local',
    manifestUrl: '/_baselines/ws2025-domain-controller.osc.yaml',
    resourceCount: 321,
    resourceTypes: ['Microsoft.OSConfig/Test'],
    scenarioName: 'SecurityBaseline/WS2025/DomainController',
  },
  {
    id: 'ws2025-workgroup-member',
    name: 'Windows Server 2025 - Workgroup Member',
    description:
      'Security baseline for Windows Server 2025 standalone/workgroup member servers.',
    platform: 'windows',
    category: 'security-baseline',
    version: '2510',
    source: 'local',
    manifestUrl: '/_baselines/ws2025-workgroup-member.osc.yaml',
    resourceCount: 296,
    resourceTypes: ['Microsoft.OSConfig/Test'],
    scenarioName: 'SecurityBaseline/WS2025/WorkgroupMember',
  },
  // ── Windows Server 2022 ──────────────────────────────────────────────
  {
    id: 'ws2022-domain-member',
    name: 'Windows Server 2022 - Member Server',
    description:
      'Azure security baseline for Windows Server 2022 member servers. 259 settings covering registry, account policy, audit policy, and user rights.',
    platform: 'windows',
    category: 'security-baseline',
    version: '2510',
    source: 'local',
    manifestUrl: '/_baselines/ws2022-domain-member.osc.yaml',
    resourceCount: 259,
    resourceTypes: ['Microsoft.OSConfig/Test'],
    scenarioName: 'SecurityBaseline/Server/2022/MemberServer',
  },
  {
    id: 'ws2022-domain-controller',
    name: 'Windows Server 2022 - Domain Controller',
    description:
      'Azure security baseline for Windows Server 2022 domain controllers with Active Directory-specific settings.',
    platform: 'windows',
    category: 'security-baseline',
    version: '2510',
    source: 'local',
    manifestUrl: '/_baselines/ws2022-domain-controller.osc.yaml',
    resourceCount: 244,
    resourceTypes: ['Microsoft.OSConfig/Test'],
    scenarioName: 'SecurityBaseline/Server/2022/DomainController',
  },
  {
    id: 'ws2022-workgroup-member',
    name: 'Windows Server 2022 - Workgroup Member',
    description:
      'Azure security baseline for Windows Server 2022 standalone/workgroup member servers.',
    platform: 'windows',
    category: 'security-baseline',
    version: '2510',
    source: 'local',
    manifestUrl: '/_baselines/ws2022-workgroup-member.osc.yaml',
    resourceCount: 202,
    resourceTypes: ['Microsoft.OSConfig/Test'],
    scenarioName: 'SecurityBaseline/Server/2022/WorkgroupMember',
  },
  // ── Windows Server 2019 ──────────────────────────────────────────────
  {
    id: 'ws2019-domain-controller',
    name: 'Windows Server 2019 - Domain Controller',
    description:
      'Azure security baseline for Windows Server 2019 domain controllers.',
    platform: 'windows',
    category: 'security-baseline',
    version: '1.0',
    source: 'local',
    manifestUrl: '/_baselines/ws2019-domain-controller.osc.yaml',
    githubUrl:
      'https://github.com/microsoft/osconfig/blob/main/manifests/azure-security-baseline-windows-server-2019-domain-controller.yaml',
    resourceCount: 250,
    resourceTypes: ['Microsoft.Windows/AuditPolicy', 'Microsoft.Windows/Registry', 'Microsoft.Windows/UserRightsAssignment', 'Microsoft.Windows/AccountPolicy'],
  },
  {
    id: 'ws2019-domain-member',
    name: 'Windows Server 2019 - Member Server',
    description:
      'Azure security baseline for Windows Server 2019 member servers.',
    platform: 'windows',
    category: 'security-baseline',
    version: '1.0',
    source: 'local',
    manifestUrl: '/_baselines/ws2019-domain-member.osc.yaml',
    githubUrl:
      'https://github.com/microsoft/osconfig/blob/main/manifests/azure-security-baseline-windows-server-2019-domain-member.yaml',
    resourceCount: 265,
    resourceTypes: ['Microsoft.Windows/AuditPolicy', 'Microsoft.Windows/Registry', 'Microsoft.Windows/UserRightsAssignment', 'Microsoft.Windows/AccountPolicy'],
  },
  {
    id: 'ws2019-workgroup-member',
    name: 'Windows Server 2019 - Workgroup Member',
    description:
      'Azure security baseline for Windows Server 2019 standalone/workgroup member servers.',
    platform: 'windows',
    category: 'security-baseline',
    version: '1.0',
    source: 'local',
    manifestUrl: '/_baselines/ws2019-workgroup-member.osc.yaml',
    githubUrl:
      'https://github.com/microsoft/osconfig/blob/main/manifests/azure-security-baseline-windows-server-2019-workgroup-member.yaml',
    resourceCount: 206,
    resourceTypes: ['Microsoft.Windows/AuditPolicy', 'Microsoft.Windows/Registry', 'Microsoft.Windows/UserRightsAssignment', 'Microsoft.Windows/AccountPolicy'],
  },
  // ── Windows Server 2016 ──────────────────────────────────────────────
  {
    id: 'ws2016-domain-controller',
    name: 'Windows Server 2016 - Domain Controller',
    description:
      'Azure security baseline for Windows Server 2016 domain controllers.',
    platform: 'windows',
    category: 'security-baseline',
    version: '1.0',
    source: 'local',
    manifestUrl: '/_baselines/ws2016-domain-controller.osc.yaml',
    githubUrl:
      'https://github.com/microsoft/osconfig/blob/main/manifests/azure-security-baseline-windows-server-2016-domain-controller.yaml',
    resourceCount: 252,
    resourceTypes: ['Microsoft.Windows/AuditPolicy', 'Microsoft.Windows/Registry', 'Microsoft.Windows/UserRightsAssignment', 'Microsoft.Windows/AccountPolicy'],
  },
  {
    id: 'ws2016-domain-member',
    name: 'Windows Server 2016 - Member Server',
    description:
      'Azure security baseline for Windows Server 2016 member servers.',
    platform: 'windows',
    category: 'security-baseline',
    version: '1.0',
    source: 'local',
    manifestUrl: '/_baselines/ws2016-domain-member.osc.yaml',
    githubUrl:
      'https://github.com/microsoft/osconfig/blob/main/manifests/azure-security-baseline-windows-server-2016-domain-member.yaml',
    resourceCount: 267,
    resourceTypes: ['Microsoft.Windows/AuditPolicy', 'Microsoft.Windows/Registry', 'Microsoft.Windows/UserRightsAssignment', 'Microsoft.Windows/AccountPolicy'],
  },
  {
    id: 'ws2016-workgroup-member',
    name: 'Windows Server 2016 - Workgroup Member',
    description:
      'Azure security baseline for Windows Server 2016 standalone/workgroup member servers.',
    platform: 'windows',
    category: 'security-baseline',
    version: '1.0',
    source: 'local',
    manifestUrl: '/_baselines/ws2016-workgroup-member.osc.yaml',
    githubUrl:
      'https://github.com/microsoft/osconfig/blob/main/manifests/azure-security-baseline-windows-server-2016-workgroup-member.yaml',
    resourceCount: 207,
    resourceTypes: ['Microsoft.Windows/AuditPolicy', 'Microsoft.Windows/Registry', 'Microsoft.Windows/UserRightsAssignment', 'Microsoft.Windows/AccountPolicy'],
  },
  {
    id: 'ws2025-secured-core',
    name: 'Windows Server 2025 - Secured Core',
    description:
      'Secured-core configuration for Windows Server 2025. Enables System Guard Launch, VBS, and HVCI.',
    platform: 'windows',
    category: 'secured-core',
    version: '2510',
    source: 'local',
    manifestUrl: '/_baselines/secured-core.osc.yaml',
    githubUrl:
      'https://github.com/microsoft/osconfig/blob/main/security/ws2025/secured_core.osc.yaml',
    resourceCount: 3,
    resourceTypes: ['Microsoft.OSConfig/Test'],
    scenarioName: 'SecuredCore',
  },
  {
    id: 'defender-antivirus',
    name: 'Microsoft Defender Antivirus',
    description:
      'Defender Antivirus configuration baseline for Windows Server. Includes ASR rules, network protection, real-time protection, and scan settings with proper compliance schemas (const, enum, range).',
    platform: 'windows',
    category: 'defender',
    version: '2510',
    source: 'local',
    manifestUrl: '/_baselines/defender-antivirus.osc.yaml',
    githubUrl:
      'https://github.com/microsoft/osconfig/blob/main/security/Defender_Antivirus-2510.csv',
    resourceCount: 48,
    resourceTypes: ['Microsoft.OSConfig/Test'],
    scenarioName: 'Defender/Antivirus',
  },
  {
    id: 'laps',
    name: 'Windows LAPS (Local Administrator Password Solution)',
    description:
      'Windows Local Administrator Password Solution (LAPS) settings for managing and backing up local administrator passwords. Includes password backup enforcement, complexity, length, age, and encryption settings.',
    platform: 'windows',
    category: 'feature-scenario',
    version: '2603.1',
    source: 'local',
    manifestUrl: '/_baselines/laps.osc.yaml',
    resourceCount: 17,
    resourceTypes: ['Microsoft.OSConfig/Test'],
    scenarioName: 'LAPS',
  },
  {
    id: 'azurelocal-sff-linux',
    name: 'Linux Security Baseline',
    description:
      'Comprehensive Linux security baseline. Covers kernel modules, file permissions, sysctl hardening, password policies, cron permissions, and network settings.',
    platform: 'linux',
    category: 'linux-security',
    version: '1.0',
    source: 'local',
    manifestUrl: '/_baselines/sff-linux-baseline.osc.yaml',
    resourceCount: 47,
    resourceTypes: [
      'Microsoft.OSConfig/File',
      'Microsoft.OSConfig/FileLine',
      'Microsoft.OSConfig/Group',
      'Linux/FilePermission',
      'Linux/KernelModule',
      'Linux/User',
    ],
  },
  // ─── CIS Windows Server Benchmarks (removed PR36) ──────────────────────────
  // CIS Benchmark content is licensed by CIS and not redistributable. The
  // bundled YAML manifests + per-OS rule catalogs were removed for legal
  // compliance. The CIS cross-reference feature still works if a user drops
  // their own legally-licensed copies of the JSON catalogs into
  // public/_baselines/cis/_data/ (see public/_baselines/cis/README.md).
];

export const CATEGORIES = [
  { id: 'all', label: 'All Baselines' },
  { id: 'security-baseline', label: 'Security Baselines' },
  { id: 'secured-core', label: 'Secured Core' },
  { id: 'defender', label: 'Defender' },
  { id: 'feature-scenario', label: 'Feature Scenarios' },
  { id: 'linux-security', label: 'Linux Security' },
] as const;
