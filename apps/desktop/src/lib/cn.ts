// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Tailwind class-merge helper. Combines `clsx` (conditional class
 * names) with `tailwind-merge` (de-duplicates conflicting Tailwind
 * utility classes).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
