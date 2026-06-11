#!/usr/bin/env node
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Ensures the Linux oscfg binary has the executable bit set after `npm install`.
 * No-op on Windows. Silent if the binary isn't bundled yet.
 */
const fs = require('fs');
const path = require('path');

if (process.platform !== 'linux') process.exit(0);

const bin = path.resolve(__dirname, '..', 'resources', 'oscfg', 'linux-x64', 'oscfg');
try {
  fs.accessSync(bin, fs.constants.F_OK);
} catch {
  // Binary not bundled yet; skip silently so `npm install` doesn't fail
  // on clones that haven't dropped the binary.
  process.exit(0);
}

try {
  fs.chmodSync(bin, 0o755);
  // eslint-disable-next-line no-console
  console.log(`[configforge] chmod +x ${bin}`);
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn(`[configforge] could not chmod oscfg: ${err.message}`);
}
