// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { pathToFileURL } from 'node:url';

export const SUPPORTED_NODE_RANGES = [
  { major: 22, minimumMinor: 12 },
  { major: 24, minimumMinor: 0 },
];

export function parseNodeVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) return null;

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

export function isSupportedNodeVersion(version) {
  const parsed = parseNodeVersion(version);
  if (!parsed) return false;

  return SUPPORTED_NODE_RANGES.some(
    ({ major, minimumMinor }) => parsed.major === major && parsed.minor >= minimumMinor,
  );
}

export function unsupportedNodeVersionMessage(version) {
  return [
    `ConfigForge source builds require Node.js 22.12+ LTS or Node.js 24 LTS; detected Node.js ${version}.`,
    '',
    '1. Install or switch to a supported LTS release (the repository version files default to Node.js 22).',
    '2. Delete the existing node_modules directory.',
    '3. Run npm ci.',
    '4. Retry the ConfigForge development or build command.',
  ].join('\n');
}

export function enforceSupportedNodeVersion(version = process.versions.node) {
  if (isSupportedNodeVersion(version)) return true;

  console.error(unsupportedNodeVersionMessage(version));
  process.exitCode = 1;
  return false;
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  enforceSupportedNodeVersion();
}
