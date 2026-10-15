// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, expect, it } from 'vitest';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import tailwindcss from 'tailwindcss';

describe('patched CSS parser compatibility', () => {
  it('preserves Tailwind 3 variants and arbitrary child selectors with parser 7', async () => {
    const classes = [
      'hover:bg-blue-500',
      'focus-visible:ring-2',
      'group-hover:block',
      'aria-expanded:block',
      '[&>svg]:h-4',
    ];
    const result = await postcss([
      tailwindcss({
        content: [{ raw: `<div class="${classes.join(' ')}"></div>`, extension: 'html' }],
        corePlugins: { preflight: false },
      }),
    ]).process('@tailwind utilities;', { from: undefined });
    const emittedClasses = new Set();
    let hasSvgChildSelector = false;
    let hasExpandedAttribute = false;

    result.root.walkRules((rule) => {
      selectorParser((selectors) => {
        selectors.walkClasses((node) => emittedClasses.add(node.value));
        selectors.walkAttributes((node) => {
          if (node.attribute === 'aria-expanded' && node.value === 'true') {
            hasExpandedAttribute = true;
          }
        });
        selectors.each((selector) => {
          if (!selector.nodes.some((node) => node.type === 'class' && node.value === '[&>svg]:h-4')) {
            return;
          }
          hasSvgChildSelector =
            selector.nodes.some((node) => node.type === 'combinator' && node.value.trim() === '>') &&
            selector.nodes.some((node) => node.type === 'tag' && node.value === 'svg');
        });
      }).processSync(rule.selector);
    });

    for (const name of classes) {
      expect(emittedClasses.has(name), name).toBe(true);
    }
    expect(hasSvgChildSelector).toBe(true);
    expect(hasExpandedAttribute).toBe(true);
  });
});
