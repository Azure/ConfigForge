// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// Smoke test: confirm the Azure Policy fuzzy matcher in cis-bulk-lookup.ts +
// cis-lookup.ts still works correctly after the v0.3.46 substring -> exact-word
// switch. We can't import the handlers directly (they have IPC plumbing), so
// we replay the matcher inline against a synthetic Azure Policy catalog.

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const corePath = join(process.cwd(), 'packages', 'core', 'dist');
const { splitPascalCase } = await import(
  pathToFileURL(join(corePath, 'cis', 'xccdf-parser.js')).href
);

// Synthetic Azure Policy catalog with a mix of plausible Linux & Windows CIS
// rule titles. None of these are CIS-licensed verbatim text.
const benchmarkRules = [
  { ruleId: 'R1', title: 'Ensure cramfs kernel module is not available' },
  { ruleId: 'R2', title: 'Ensure SSH root login is disabled' },
  { ruleId: 'R3', title: 'Ensure password complexity is enforced' },
  { ruleId: 'R4', title: 'Audit Security Group Management' },
  { ruleId: 'R5', title: 'Ensure auditd service is enabled' },
];

// Resources we'd see in real OSConfig manifests.
const cases = [
  { name: 'CramfsKernelModule', expected: 'R1', why: 'cramfs+kernel+module overlap' },
  { name: 'SshRootLogin', expected: 'R2', why: 'ssh+root+login overlap' },
  { name: 'PasswordComplexity', expected: 'R3', why: 'password+complexity overlap' },
  { name: 'AuditSecurityGroupManagement', expected: 'R4', why: 'security+group+management+audit overlap' },
  { name: 'AuditdServiceEnabled', expected: 'R5', why: 'auditd+service+enabled overlap' },
  // Negative tests — these should NOT match anything at 0.8.
  { name: 'UseDiagnostics', expected: null, why: 'pre-fix: "use" substring-matched "ensure"; post-fix: no match' },
  { name: 'CompletelyUnrelated', expected: null, why: 'no token overlap' },
];

// Replay the Azure Policy fuzzy matcher logic from cis-bulk-lookup.ts.
function matchAzurePolicy(resourceName) {
  const words = splitPascalCase(resourceName);
  if (words.length === 0) return null;
  let bestRatio = 0;
  let best = null;
  for (const rule of benchmarkRules) {
    const titleWordSet = new Set(splitPascalCase(rule.title));
    const matched = words.filter((w) => titleWordSet.has(w));
    const ratio = matched.length / words.length;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = rule;
    }
  }
  return bestRatio >= 0.8 ? { rule: best, ratio: bestRatio } : null;
}

let pass = 0;
let fail = 0;
for (const c of cases) {
  const hit = matchAzurePolicy(c.name);
  const got = hit?.rule.ruleId ?? null;
  const ok = got === c.expected;
  console.log(`${ok ? '✅' : '❌'} ${c.name.padEnd(32)} expected=${c.expected ?? 'null'}  got=${got ?? 'null'}  ratio=${hit?.ratio.toFixed(2) ?? '-'}    (${c.why})`);
  if (ok) pass++;
  else fail++;
}
console.log(`\n${pass}/${pass + fail} cases passed.`);
process.exit(fail > 0 ? 1 : 0);
