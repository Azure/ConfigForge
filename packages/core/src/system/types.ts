// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Shared system info type — returned by either the Windows or Linux backend.
 */
export interface SystemInfo {
  platform: NodeJS.Platform;
  isAdmin: boolean;
  serverType: string;
  osVersion: string;
}
