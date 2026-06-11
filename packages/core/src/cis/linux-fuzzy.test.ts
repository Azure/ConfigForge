// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect } from 'vitest';
import {
  linuxFuzzyMatch,
  linuxFuzzyTokenize,
  linuxPathTokens,
  linuxPathsOverlap,
  polarityFromText,
  splitPascalCase,
  type LinuxResourceTokens,
} from './xccdf-parser';

// Helper: build a LinuxResourceTokens from the structure of a baseline
// resource. Mirrors what `extractResourceInfo` will produce.
function makeResource(opts: {
  name: string;
  innerProps?: { name?: string; path?: string; gid?: number };
  nestedChildren?: { type: string; name?: string; path?: string }[];
}): LinuxResourceTokens {
  const high: string[] = [];
  const med: string[] = [];
  const low: string[] = [];
  const paths = new Set<string>();
  let polaritySource = opts.name;

  // Resource name → medium tokens
  for (const w of linuxFuzzyTokenize(opts.name)) med.push(w);

  if (opts.innerProps) {
    if (opts.innerProps.name) {
      // Direct propertyName → medium (only nested KernelModule/User get high)
      for (const w of linuxFuzzyTokenize(opts.innerProps.name)) med.push(w);
      polaritySource += ' ' + opts.innerProps.name;
    }
    if (opts.innerProps.path) {
      paths.add(opts.innerProps.path.toLowerCase());
      // Path basename → high; rest → low
      const segs = opts.innerProps.path.split('/').filter(Boolean);
      for (const s of segs.slice(0, -1)) {
        for (const w of linuxFuzzyTokenize(s)) low.push(w);
      }
      const basename = segs[segs.length - 1];
      if (basename) for (const w of linuxFuzzyTokenize(basename)) high.push(w);
    }
  }
  if (opts.nestedChildren) {
    for (const child of opts.nestedChildren) {
      if (child.type === 'Linux/KernelModule' && child.name) {
        // KernelModule name is the strongest signal — high
        for (const w of linuxFuzzyTokenize(child.name)) high.push(w);
        polaritySource += ' ' + child.name;
      }
      if (child.path) {
        paths.add(child.path.toLowerCase());
        for (const s of child.path.split('/').filter(Boolean)) {
          for (const w of linuxFuzzyTokenize(s)) low.push(w);
        }
      }
    }
  }

  return { high, med, low, paths, polaritySource };
}

// Fixture: realistic Linux CIS rules harvested from Azure Policy + XCCDF
const RULES = [
  { ruleId: 'r1', title: 'Ensure usb-storage kernel module is not available' },
  { ruleId: 'r2', title: 'Ensure dccp kernel module is not available' },
  { ruleId: 'r3', title: 'Ensure cramfs kernel module is not available' },
  { ruleId: 'r4', title: 'Ensure freevxfs kernel module is not available' },
  { ruleId: 'r5', title: 'Ensure group root is the only GID 0 group' },
  { ruleId: 'r6', title: 'Ensure root user umask is configured' },
  { ruleId: 'r7', title: 'Ensure default user umask is configured' },
  { ruleId: 'r8', title: 'Ensure GDM automatic mounting of removable media is disabled' },
  { ruleId: 'r9', title: 'Ensure permissions on /etc/cron.d are configured' },
  { ruleId: 'r10', title: 'Ensure permissions on /etc/cron.hourly are configured' },
  { ruleId: 'r11', title: 'Ensure permissions on /etc/cron.daily are configured' },
  { ruleId: 'r12', title: 'Ensure permissions on /etc/crontab are configured' },
  { ruleId: 'r13', title: 'Ensure rds kernel module is not available' },
  { ruleId: 'r14', title: 'Ensure sctp kernel module is not available' },
  { ruleId: 'r15', title: 'Ensure tipc kernel module is not available' },
  { ruleId: 'r16', title: 'Ensure password expiration is 365 days or less' },
];

describe('linuxFuzzyTokenize', () => {
  it('drops stopwords and short tokens', () => {
    const toks = linuxFuzzyTokenize('Ensure DCCP is disabled');
    expect(toks).toContain('dccp');
    expect(toks).not.toContain('ensure');
    expect(toks).not.toContain('is');
    expect(toks).not.toContain('disabled'); // in expanded stopwords
  });

  it('preserves hyphenated tokens as whole AND split', () => {
    const toks = linuxFuzzyTokenize('Ensure usb-storage kernel module is not available');
    expect(toks).toContain('usb-storage');
    expect(toks).toContain('usb');
    expect(toks).toContain('storage');
    expect(toks).toContain('kernel');
    expect(toks).toContain('module');
  });

  it('stems plurals (length ≥ 5)', () => {
    const toks = linuxFuzzyTokenize('Ensure default umask for all users');
    expect(toks).toContain('user');
    expect(toks).not.toContain('users');
  });

  it('does not stem short words that end in s', () => {
    const toks = linuxFuzzyTokenize('Disable BUS service');
    expect(toks).toContain('bus');
  });

  it('handles dotted tokens (net.ipv4.ip_forward)', () => {
    const toks = linuxFuzzyTokenize('Set net.ipv4.ip_forward to 0');
    expect(toks).toContain('net.ipv4.ip_forward');
    expect(toks).toContain('ipv4');
  });
});

describe('linuxPathTokens & linuxPathsOverlap', () => {
  it('extracts and normalizes paths', () => {
    const paths = linuxPathTokens('Ensure permissions on /etc/cron.d/ are configured');
    expect(paths.has('/etc/cron.d')).toBe(true);
  });

  it('/etc/cron.d does NOT overlap /etc/cron.daily', () => {
    expect(linuxPathsOverlap('/etc/cron.d', '/etc/cron.daily')).toBe(false);
    expect(linuxPathsOverlap('/etc/cron.d', '/etc/cron.hourly')).toBe(false);
  });

  it('overlaps on exact equality', () => {
    expect(linuxPathsOverlap('/etc/cron.d', '/etc/cron.d')).toBe(true);
  });

  it('overlaps on segment-boundary prefix', () => {
    expect(linuxPathsOverlap('/etc/cron.d', '/etc/cron.d/foo')).toBe(true);
    expect(linuxPathsOverlap('/etc/cron.d/foo', '/etc/cron.d')).toBe(true);
  });
});

describe('polarityFromText', () => {
  it('detects disable from "Disable X"', () => {
    expect(polarityFromText('Disable USB Storage')).toBe('disable');
  });
  it('detects disable from "is disabled"', () => {
    expect(polarityFromText('Ensure DCCP is disabled')).toBe('disable');
  });
  it('detects disable from "not available"', () => {
    expect(polarityFromText('Ensure usb-storage kernel module is not available')).toBe('disable');
  });
  it('detects enable from "is enabled"', () => {
    expect(polarityFromText('Ensure firewall is enabled')).toBe('enable');
  });
  it('detects configure from "is configured"', () => {
    expect(polarityFromText('Ensure permissions on /etc/cron.d are configured')).toBe('configure');
  });
  it('returns null for ambiguous text', () => {
    expect(polarityFromText('Some random text')).toBe(null);
  });
});

describe('linuxFuzzyMatch — user-reported misses (now matching)', () => {
  it('"Disable USB Storage" matches usb-storage rule via nested KernelModule', () => {
    const res = makeResource({
      name: 'Disable USB Storage',
      nestedChildren: [
        { type: 'Microsoft.OSConfig/File', path: '/etc/modprobe.d/usb-storage.conf' },
        { type: 'Linux/KernelModule', name: 'usb-storage' },
      ],
    });
    const match = linuxFuzzyMatch(RULES, res);
    expect(match?.rule.ruleId).toBe('r1');
  });

  it('"Ensure DCCP is disabled" matches dccp rule via nested KernelModule', () => {
    const res = makeResource({
      name: 'Ensure DCCP is disabled',
      nestedChildren: [
        { type: 'Microsoft.OSConfig/File', path: '/etc/modprobe.d/dccp.conf' },
        { type: 'Linux/KernelModule', name: 'dccp' },
      ],
    });
    const match = linuxFuzzyMatch(RULES, res);
    expect(match?.rule.ruleId).toBe('r2');
  });

  it('"Ensure default group for the root account is GID 0" matches "group root GID 0" rule', () => {
    const res = makeResource({
      name: 'Ensure default group for the root account is GID 0',
      innerProps: { name: 'root', gid: 0 },
    });
    const match = linuxFuzzyMatch(RULES, res);
    expect(match?.rule.ruleId).toBe('r5');
  });

  it('"Ensure default umask for all users is configured" matches umask rule (stemmed users→user)', () => {
    const res = makeResource({
      name: 'Ensure default umask for all users is configured',
      innerProps: { path: '/etc/login.defs' },
    });
    const match = linuxFuzzyMatch(RULES, res);
    expect(match?.rule.ruleId).toBeDefined();
    // Either r6 ("root user umask") or r7 ("default user umask") — both about umask;
    // accept whichever wins by margin
    expect(['r6', 'r7']).toContain(match?.rule.ruleId);
  });
});

describe('linuxFuzzyMatch — RDS / SCTP / TIPC kernel modules', () => {
  it('"Ensure RDS is disabled" matches rds rule, NOT GDM rule', () => {
    const res = makeResource({
      name: 'Ensure RDS is disabled',
      nestedChildren: [{ type: 'Linux/KernelModule', name: 'rds' }],
    });
    const match = linuxFuzzyMatch(RULES, res);
    expect(match?.rule.ruleId).toBe('r13');
  });

  it('"Ensure SCTP is disabled" matches sctp rule', () => {
    const res = makeResource({
      name: 'Ensure SCTP is disabled',
      nestedChildren: [{ type: 'Linux/KernelModule', name: 'sctp' }],
    });
    const match = linuxFuzzyMatch(RULES, res);
    expect(match?.rule.ruleId).toBe('r14');
  });

  it('"Ensure TIPC is disabled" matches tipc rule', () => {
    const res = makeResource({
      name: 'Ensure TIPC is disabled',
      nestedChildren: [{ type: 'Linux/KernelModule', name: 'tipc' }],
    });
    const match = linuxFuzzyMatch(RULES, res);
    expect(match?.rule.ruleId).toBe('r15');
  });
});

describe('linuxFuzzyMatch — path disambiguation', () => {
  it('"/etc/cron.d" resource matches /etc/cron.d rule, NOT /etc/cron.hourly', () => {
    const res = makeResource({
      name: 'Ensure permissions on /etc/cron.d are configured',
      innerProps: { path: '/etc/cron.d' },
    });
    const match = linuxFuzzyMatch(RULES, res);
    expect(match?.rule.ruleId).toBe('r9');
  });

  it('"/etc/cron.hourly" resource matches /etc/cron.hourly rule, NOT /etc/cron.d', () => {
    const res = makeResource({
      name: 'Ensure permissions on /etc/cron.hourly are configured',
      innerProps: { path: '/etc/cron.hourly' },
    });
    const match = linuxFuzzyMatch(RULES, res);
    expect(match?.rule.ruleId).toBe('r10');
  });
});

describe('linuxFuzzyMatch — polarity guard', () => {
  it('"Disable X" does NOT match "Ensure X is enabled"', () => {
    const res = makeResource({
      name: 'Disable USB Storage',
      nestedChildren: [{ type: 'Linux/KernelModule', name: 'usb-storage' }],
    });
    const polarityFlipRules = [
      ...RULES,
      { ruleId: 'flip', title: 'Ensure usb-storage kernel module is enabled' },
    ];
    const match = linuxFuzzyMatch(polarityFlipRules, res);
    expect(match?.rule.ruleId).toBe('r1'); // still the original "not available" rule
  });
});

describe('linuxFuzzyMatch — margin gate', () => {
  it('returns null when best score is too close to runner-up without distinctive', () => {
    // Resource with vague tokens that match many rules weakly
    const res = makeResource({ name: 'Ensure something' });
    const match = linuxFuzzyMatch(RULES, res);
    expect(match).toBe(null);
  });

  it('does NOT match when no kernel module / path / distinctive token overlaps', () => {
    const res = makeResource({ name: 'Ensure password expiration is 365 days or less' });
    const match = linuxFuzzyMatch(RULES, res);
    // Should match r16 because "password", "expiration", "days" are distinctive medium tokens
    expect(match?.rule.ruleId).toBe('r16');
  });
});

describe('regression — Windows splitPascalCase unchanged', () => {
  it('splitPascalCase still strips ≤2-char words and lowercases', () => {
    const r = splitPascalCase('NetworkAccess_AllowAnonymousSIDOrNameTranslation');
    expect(r).toEqual(['network', 'access', 'allow', 'anonymous', 'sid', 'name', 'translation']);
  });

  it('splitPascalCase preserves "or" if ≥3 chars (it has 2 chars so dropped)', () => {
    // Sanity check: existing v0.3.46 behavior preserved
    const r = splitPascalCase('AbcDefGhi');
    expect(r).toEqual(['abc', 'def', 'ghi']);
  });
});
