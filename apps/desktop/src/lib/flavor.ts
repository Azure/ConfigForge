// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Build-time renderer flavor flags.
 *
 * Vite replaces `VITE_CFS_FLAVOR` with a literal, allowing author-only
 * bundles to tree-shake device operations even when compatibility methods
 * remain present on the preload bridge.
 */
export type CfsFlavor = "full" | "author";

const raw = (import.meta.env.VITE_CFS_FLAVOR ?? "full") as string;

export const FLAVOR: CfsFlavor = raw === "author" ? "author" : "full";
export const HAS_DEPLOY = FLAVOR === "full";
export const HAS_ELEVATION = FLAVOR === "full";
export const HAS_DEVICE_AUDIT = FLAVOR === "full";
export const HAS_HEALTH = FLAVOR === "full";
export const HAS_ACTIVITY_FEED = FLAVOR === "full";
