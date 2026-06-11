// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { getI18n } from '../locales';
import { useDateFormatter, useNumberFormatter, useRelativeTimeFormatter } from './format';

describe('locale-aware format hooks', () => {
  afterEach(async () => {
    await getI18n().changeLanguage('en');
  });

  it('formats dates with the active i18n language', async () => {
    const date = new Date('2026-05-28T12:00:00Z');
    const options: Intl.DateTimeFormatOptions = { dateStyle: 'long', timeZone: 'UTC' };
    const { result, rerender } = renderHook(() => useDateFormatter(options));

    expect(result.current.format(date)).toBe('May 28, 2026');

    await getI18n().changeLanguage('de');
    rerender();
    expect(result.current.format(date)).toBe('28. Mai 2026');
  });

  it('formats numbers with locale-specific separators', async () => {
    const options: Intl.NumberFormatOptions = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
    const { result, rerender } = renderHook(() => useNumberFormatter(options));

    expect(result.current.format(1234.5)).toBe('1,234.5');

    await getI18n().changeLanguage('de');
    rerender();
    expect(result.current.format(1234.5)).toBe('1.234,5');
  });

  it('formats relative time with locale-specific words', async () => {
    const { result, rerender } = renderHook(() => useRelativeTimeFormatter());

    expect(result.current.format(-1, 'day')).toBe('yesterday');

    await getI18n().changeLanguage('de');
    rerender();
    expect(result.current.format(-1, 'day')).toBe('gestern');
  });
});
