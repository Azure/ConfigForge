#!/usr/bin/env bash
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

#
# verify-no-cli-binary.sh — fails non-zero if any OSConfig CLI binary
# is found inside the release artifact tree.
#
# ConfigForge v0.2.0+ does NOT bundle the OSConfig CLI. Users
# install `oscfg` separately (see INSTALL.md). This script is the
# belt-and-suspenders check that protects against an accidental
# re-add of the bundled binary via electron-builder.yml extraResources.
#
# Wire into .github/workflows/release.yml after the publish steps:
#
#   - name: Verify no OSConfig CLI binary in artifacts
#     if: always()
#     run: bash scripts/verify-no-cli-binary.sh apps/desktop/release
#
# (Already prepared on the Phase F branch but left unwired so it can
# land with the surrounding release.yml hardening in a single commit.)
#
# Exit codes:
#   0  no oscfg binary found (good)
#   1  oscfg binary found (build fails)
#   2  usage error
set -eu

DIR="${1:-apps/desktop/release}"

if [ ! -d "$DIR" ]; then
  echo "verify-no-cli-binary: directory not found: $DIR" >&2
  exit 2
fi

# Match `oscfg`, `oscfg.exe`, `oscfg_event.dll`, anything starting
# with `oscfg` under the release tree.
found=$(find "$DIR" -type f \( -iname 'oscfg' -o -iname 'oscfg.*' \) 2>/dev/null || true)

if [ -n "$found" ]; then
  echo "ERROR: OSConfig CLI binary found in release artifacts:" >&2
  echo "$found" >&2
  echo "" >&2
  echo "ConfigForge must not redistribute the OSConfig CLI." >&2
  echo "Check apps/desktop/electron-builder.yml for an accidental" >&2
  echo "extraResources entry that re-includes resources/oscfg/." >&2
  exit 1
fi

echo "OK — no oscfg binary found in $DIR"
