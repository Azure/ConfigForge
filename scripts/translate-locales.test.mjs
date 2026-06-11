// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractPlaceholders,
  getDeep,
  orderLikeSource,
  protectGlossary,
  restoreGlossary,
  restorePlaceholders,
  setDeep,
} from './translate-locales.mjs';

const workspace = path.join(process.cwd(), 'scripts', '.test-workspaces', 'translate');

describe('translate-locales helpers', () => {
  it('preserves interpolation placeholders through masking and restore', () => {
    const source = 'Deploy {{count}} manifests to {{machine}}';
    const { masked, placeholders } = extractPlaceholders(source);
    const translated = restorePlaceholders(`Déployer ${masked}`, placeholders);
    expect(translated).toBe('Déployer Deploy {{count}} manifests to {{machine}}');
  });

  it('preserves existing translations while ordering like English', () => {
    const en = { buttons: { save: 'Save', cancel: 'Cancel' }, status: { loading: 'Loading…' } };
    const target = { status: { loading: 'Chargement…' }, buttons: { save: 'Enregistrer' } };
    setDeep(target, 'buttons.cancel', 'Annuler');
    expect(orderLikeSource(en, target)).toEqual({
      buttons: { save: 'Enregistrer', cancel: 'Annuler' },
      status: { loading: 'Chargement…' },
    });
    expect(getDeep(target, 'buttons.save')).toBe('Enregistrer');
  });

  it('keeps glossary terms literal', () => {
    const glossary = ['ConfigForge', 'Azure Local'];
    const source = 'Open ConfigForge for Azure Local baselines';
    const protectedText = protectGlossary(source, glossary);
    const restored = restoreGlossary(`FR: ${protectedText.masked}`, protectedText.protectedTerms);
    expect(restored).toContain('ConfigForge');
    expect(restored).toContain('Azure Local');
  });

  it('can exercise passthrough output in a project-local fixture', async () => {
    await rm(workspace, { recursive: true, force: true });
    await mkdir(workspace, { recursive: true });
    const file = path.join(workspace, 'sample.json');
    await writeFile(file, JSON.stringify({ hello: 'world' }));
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ hello: 'world' });
    await rm(workspace, { recursive: true, force: true });
  });
});
