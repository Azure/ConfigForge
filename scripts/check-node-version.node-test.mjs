// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSupportedNodeVersion,
  parseNodeVersion,
  unsupportedNodeVersionMessage,
} from './check-node-version.mjs';

test('accepts supported Node.js 22 and 24 LTS releases', () => {
  assert.deepEqual(parseNodeVersion('v22.14.0'), { major: 22, minor: 14, patch: 0 });
  assert.equal(isSupportedNodeVersion('22.12.0'), true);
  assert.equal(isSupportedNodeVersion('v22.14.0'), true);
  assert.equal(isSupportedNodeVersion('24.0.0'), true);
  assert.equal(isSupportedNodeVersion('v24.15.0'), true);
});

test('rejects unsupported Node.js releases with recovery guidance', () => {
  assert.equal(isSupportedNodeVersion('22.11.0'), false);
  assert.equal(isSupportedNodeVersion('23.11.0'), false);
  assert.equal(isSupportedNodeVersion('25.0.0'), false);
  assert.equal(isSupportedNodeVersion('24.0.0-nightly.1'), false);
  assert.equal(isSupportedNodeVersion('not-a-version'), false);

  const message = unsupportedNodeVersionMessage('23.11.0');
  assert.match(message, /require Node\.js 22\.12\+ LTS or Node\.js 24 LTS/);
  assert.match(message, /detected Node\.js 23\.11\.0/);
  assert.match(message, /Delete the existing node_modules directory/);
  assert.match(message, /Run npm ci/);
});
