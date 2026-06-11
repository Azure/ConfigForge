// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Namespace naming: ConfigForge lets users pick display names like "WS2025 Member Server".
 * oscfg namespaces are used in filesystem paths and CLI args, so we restrict them to a
 * conservative slug. We persist the display name separately in registration metadata.
 */

const SLUG_MAX_LEN = 96;

export function sanitizeNamespace(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  // Replace any char outside [A-Za-z0-9._-] with '-', then strip leading/
  // trailing '-'. The strip is done by index rather than an anchored-quantifier
  // regex (e.g. /^-+|-+$/) to avoid js/polynomial-redos backtracking.
  const collapsed = trimmed.replace(/[^A-Za-z0-9._-]+/g, '-');
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed[start] === '-') start++;
  while (end > start && collapsed[end - 1] === '-') end--;
  return collapsed.slice(start, end).slice(0, SLUG_MAX_LEN);
}

export function isValidNamespace(input: string): boolean {
  if (!input) return false;
  if (input.length > SLUG_MAX_LEN) return false;
  // CF-SEC: reject path traversal sequences and bare-dot directories.
  // The character class below permits dots/dashes, so a value of '..' or '.'
  // would pass the regex but represents a parent/current directory when used
  // in path.join — explicitly block these (and any embedded '..' segment).
  if (input === '.' || input === '..' || input.includes('..')) return false;
  return /^[A-Za-z0-9._-]+$/.test(input);
}
