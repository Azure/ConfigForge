// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

function useActiveI18nLocale(): string {
  const { i18n } = useTranslation();
  return i18n.resolvedLanguage || i18n.language || 'en';
}

export function useDateFormatter(opts?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const locale = useActiveI18nLocale();
  return useMemo(() => new Intl.DateTimeFormat(locale, opts), [locale, opts]);
}

export function useNumberFormatter(opts?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const locale = useActiveI18nLocale();
  return useMemo(() => new Intl.NumberFormat(locale, opts), [locale, opts]);
}

export function useRelativeTimeFormatter(opts?: Intl.RelativeTimeFormatOptions): Intl.RelativeTimeFormat {
  const locale = useActiveI18nLocale();
  return useMemo(
    () => new Intl.RelativeTimeFormat(locale, opts ?? { numeric: 'auto' }),
    [locale, opts],
  );
}
