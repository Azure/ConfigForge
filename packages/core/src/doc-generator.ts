// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import yaml from 'js-yaml';
import { getPlatformForType } from './platform';
import { escMdInline, escMdCell, escInlineCode } from './markdown/escape';

interface Resource {
  name?: string;
  Name?: string;
  type?: string;
  Type?: string;
  value?: unknown;
  properties?: Record<string, unknown>;
  compliance?: Record<string, unknown>;
  dependsOn?: string | string[];
}

function renderResources(resources: Resource[], lines: string[], startIndex: number, indent = ''): number {
  let idx = startIndex;
  for (const r of resources) {
    idx++;
    const name = String(r.name ?? r.Name ?? `Resource ${idx}`);
    const type = String(r.type ?? r.Type ?? 'unknown');
    const props = r.properties as Record<string, unknown> | undefined;
    const compliance = r.compliance as Record<string, unknown> | undefined;
    const hasValue = r.value !== undefined;

    // CF-SEC-005: manifest-derived names and types were previously
    // inserted into Markdown headings and inline code spans without
    // escaping, letting a crafted manifest spoof headings or inject
    // markdown / HTML constructs into auditor-facing documentation.
    lines.push(`${indent}### ${idx}. ${escMdInline(name)}`);
    lines.push('');
    lines.push(`${indent}- **Type:** \`${escInlineCode(type)}\``);
    lines.push(`${indent}- **Mode:** ${hasValue ? '🔧 Enforce' : '📋 Audit only'}`);

    if (props) {
      // Handle nested Group resources
      if (type === 'Microsoft.OSConfig/Group' && Array.isArray(props.resources)) {
        const subResources = props.resources as Resource[];
        lines.push(`${indent}- **Sub-resources:** ${subResources.length}`);

        // Show other properties first (excluding the nested resources array)
        const otherProps = Object.entries(props).filter(([k]) => k !== 'resources');
        if (otherProps.length > 0) {
          lines.push(`${indent}- **Properties:**`);
          for (const [k, v] of otherProps) {
            const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
            lines.push(`${indent}  - \`${escInlineCode(k)}\`: ${escMdInline(val)}`);
          }
        }

        lines.push('');
        lines.push(`${indent}> **Group contents:**`);
        lines.push('');

        // Recurse into sub-resources with indentation
        renderResources(subResources, lines, 0, indent + '> ');
        continue;
      }

      lines.push(`${indent}- **Properties:**`);
      for (const [k, v] of Object.entries(props)) {
        const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
        lines.push(`${indent}  - \`${escInlineCode(k)}\`: ${escMdInline(val)}`);
      }
    }

    if (hasValue) {
      const val = typeof r.value === 'object' ? JSON.stringify(r.value) : String(r.value);
      lines.push(`${indent}- **Desired Value:** \`${escInlineCode(val)}\``);
    }

    if (compliance) {
      const entries = Object.entries(compliance)
        .map(([k, v]) => `${escMdInline(k)}: ${escMdInline(String(v))}`)
        .join(', ');
      lines.push(`${indent}- **Compliance Criteria:** ${entries}`);
    }

    if (r.dependsOn) {
      const deps = Array.isArray(r.dependsOn) ? r.dependsOn : [r.dependsOn];
      lines.push(`${indent}- **Depends On:** ${deps.map(d => `"${escMdInline(d)}"`).join(', ')}`);
    }

    lines.push('');
  }
  return idx;
}

export function generateManifestDoc(content: string, manifestName: string): string {
  let doc: Record<string, unknown>;
  try {
    doc = (content.trimStart().startsWith('{') ? JSON.parse(content) : yaml.load(content)) as Record<string, unknown>;
  } catch {
    return `# ${escMdInline(manifestName)}\n\nError: Could not parse manifest content.`;
  }

  const resources = (doc.resources ?? []) as Resource[];
  const now = new Date().toISOString().split('T')[0];

  // Collect all types (including nested group resources)
  function collectTypes(res: Resource[]): string[] {
    const result: string[] = [];
    for (const r of res) {
      result.push(String(r.type ?? r.Type ?? ''));
      if (r.properties && Array.isArray((r.properties as Record<string, unknown>).resources)) {
        result.push(...collectTypes((r.properties as Record<string, unknown>).resources as Resource[]));
      }
    }
    return result;
  }

  const types = collectTypes(resources);
  const hasWindows = types.some(t => t.startsWith('Microsoft.Windows/'));
  const hasLinux = types.some(t => t.startsWith('Linux/'));
  const platform = hasWindows && hasLinux ? 'Cross-Platform' : hasWindows ? 'Windows' : hasLinux ? 'Linux' : 'Cross-Platform';

  const typeCounts: Record<string, number> = {};
  types.forEach(t => { typeCounts[t] = (typeCounts[t] ?? 0) + 1; });

  const enforced = resources.filter(r => r.value !== undefined).length;
  const auditOnly = resources.length - enforced;

  const lines: string[] = [];

  // Header — `manifestName` flows in from the caller (registered
  // namespace) and is treated as untrusted; even though our namespace
  // sanitizer is strict, defense-in-depth keeps the boundary clean.
  lines.push(`# ${escMdInline(manifestName)}`);
  lines.push('');
  lines.push(`> Generated by ConfigForge on ${now}`);
  lines.push('');

  // Summary table
  lines.push('## Summary');
  lines.push('');
  lines.push('| Property | Value |');
  lines.push('|----------|-------|');
  lines.push(`| **Name** | ${escMdCell(manifestName)} |`);
  lines.push(`| **Platform** | ${platform} |`);
  lines.push(`| **Total Resources** | ${resources.length} |`);
  lines.push(`| **Enforcement** | ${enforced} enforced, ${auditOnly} audit-only |`);
  if (doc.$schema) lines.push(`| **Schema** | \`${escInlineCode(String(doc.$schema))}\` |`);
  lines.push('');

  // Resource type breakdown
  lines.push('## Resource Types');
  lines.push('');
  lines.push('| Type | Count |');
  lines.push('|------|-------|');
  Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
    const platformLabel = getPlatformForType(type);
    lines.push(`| \`${escInlineCode(type)}\` (${escMdCell(platformLabel)}) | ${count} |`);
  });
  lines.push('');

  // Resource details
  lines.push('## Resources');
  lines.push('');

  renderResources(resources, lines, 0);

  // Footer
  lines.push('---');
  lines.push('');
  lines.push(`*This document was auto-generated from the \`${escInlineCode(manifestName)}\` OSConfig manifest.*`);

  return lines.join('\n');
}
