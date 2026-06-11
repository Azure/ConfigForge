// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * v0.3.1 (#12) — lightweight breadcrumb for nested pages.
 *
 * Renders `A > B > C` where leading items are links and the last
 * item is plain text (the current page). Chevron separators echo the
 * Fluent design pattern. Keeps deps minimal — `react-router-dom`
 * `<Link>` is already in the bundle.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRightRegular } from '@fluentui/react-icons';

export interface BreadcrumbItem {
  /** Visible label. */
  label: string;
  /** Route to navigate to. Omit on the last (current-page) item. */
  to?: string;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps): React.ReactElement | null {
  const { t } = useTranslation('common');
  if (!items || items.length === 0) return null;
  return (
    <nav
      aria-label={t('a11y.breadcrumb')}
      className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 mb-3"
    >
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        return (
          <React.Fragment key={`${item.label}-${idx}`}>
            {isLast || !item.to ? (
              <span
                className={
                  isLast
                    ? 'font-medium text-slate-700 dark:text-slate-200'
                    : ''
                }
                aria-current={isLast ? 'page' : undefined}
              >
                {item.label}
              </span>
            ) : (
              <Link
                to={item.to}
                className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
              >
                {item.label}
              </Link>
            )}
            {!isLast && (
              <ChevronRightRegular
                aria-hidden="true"
                className="opacity-60"
                style={{ fontSize: 12 }}
              />
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
