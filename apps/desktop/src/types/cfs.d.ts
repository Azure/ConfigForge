// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import type { CfsApi } from '../../electron/preload';

declare global {
  interface Window {
    cfs: CfsApi;
  }
}

export {};
