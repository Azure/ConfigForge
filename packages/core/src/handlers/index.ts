// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Barrel for `packages/core/src/handlers/`.
 *
 * Pure functions consumed by both Next.js routes and Electron IPC.
 * Each handler module owns its in-process cache and test affordances.
 */
export * from './contract';
export * from './errors';
export * from './cache';
export * from './health';
export * from './cis-status';
export * from './scenarios';
export * from './activity';
export * from './library';
export * from './drift';
export * from './cis-lookup';
export * from './cis-bulk-lookup';
export * from './system-config';
export * from './rationale';
export * from './history';
export * from './settings';
export * from './docs';
export * from './manifests-status';
export * from './diff-matrix';
export * from './compliance-report';
// Phase 4-B mutations
export * from './revert';
export * from './history-write';
export * from './rationale-write';
export * from './docs-write';
export * from './baseline-csv';
// Phase 4-B2 manifests CRUD
export * from './manifests';
// Phase 4-C file upload (import)
export * from './import';
// Phase 4-D streamed downloads
export * from './audit-pack';
export * from './matrix-xlsx';
export * from './export';
// Phase 4-E deploy with progress + cancellation
export * from './deploy';

