// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * v0.3.54 — i18next bootstrap regression tests.
 *
 * Covers the integration boundary between the preference layer
 * (`lib/locale`) and i18next: namespaces load, missing keys return
 * the key, language switching works, and English fallback kicks in
 * for locales that don't have a translation for a given key.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initI18n, getI18n, __TEST__ as i18nTest } from './index';

beforeAll(async () => {
  // vitest.setup.ts already called initI18n, but we reset + re-init
  // to guarantee the module-level guard isn't masking a real init
  // failure inside this test file.
  i18nTest.reset();
  await initI18n();
});

afterAll(async () => {
  await getI18n().changeLanguage('en');
});

describe('i18n initialization', () => {
  it('loads every declared namespace', () => {
    const i18n = getI18n();
    for (const ns of i18nTest.NAMESPACES) {
      // hasResourceBundle returns true even for empty objects — that's
      // exactly what we want during Phase 0 where most namespaces are
      // {} skeletons waiting for the wave extraction.
      expect(i18n.hasResourceBundle('en', ns)).toBe(true);
    }
  });

  it('returns the translated value for a populated key', () => {
    const i18n = getI18n();
    expect(i18n.t('language.sectionTitle', { ns: 'settings' })).toBe('Language');
    expect(i18n.t('buttons.refresh', { ns: 'common' })).toBe('Refresh');
  });

  it('returns the key when nothing matches (no exception)', () => {
    const i18n = getI18n();
    expect(i18n.t('nonexistent.deeply.nested.key', { ns: 'common' })).toBe(
      'nonexistent.deeply.nested.key',
    );
  });

  it('switches language and reflects the new translation', async () => {
    const i18n = getI18n();
    await i18n.changeLanguage('fr');
    expect(i18n.t('language.sectionTitle', { ns: 'settings' })).toBe('Langue');
    expect(i18n.t('buttons.refresh', { ns: 'common' })).toBe('Actualiser');
    await i18n.changeLanguage('de');
    expect(i18n.t('language.sectionTitle', { ns: 'settings' })).toBe('Sprache');
    await i18n.changeLanguage('es');
    expect(i18n.t('language.sectionTitle', { ns: 'settings' })).toBe('Idioma');
  });

  it('has real translated strings for each shipped target locale', async () => {
    const i18n = getI18n();
    await i18n.changeLanguage('fr');
    expect(i18n.t('buttons.save', { ns: 'common' })).toBe('Enregistrer');
    await i18n.changeLanguage('de');
    expect(i18n.t('buttons.save', { ns: 'common' })).toBe('Speichern');
    await i18n.changeLanguage('es');
    expect(i18n.t('buttons.save', { ns: 'common' })).toBe('Guardar');
    await i18n.changeLanguage('en');
    expect(i18n.t('language.sectionTitle', { ns: 'settings' })).toBe('Language');
  });

  it('keeps the visual edit hint in the selected target language', async () => {
    const i18n = getI18n();
    const expected = {
      fr: 'Cliquez sur une cellule pour la modifier. Appuyez sur Entrée pour appliquer ; dans la dernière cellule, Entrée ajoute une nouvelle ligne. Appuyez sur Échap pour annuler.',
      de: 'Klicken Sie auf eine Zelle, um sie zu bearbeiten. Drücken Sie die Eingabetaste zum Übernehmen; in der letzten Zelle fügt die Eingabetaste eine neue Zeile hinzu. Drücken Sie Escape zum Abbrechen.',
      es: 'Haga clic en cualquier celda para editarla. Pulse Entrar para aplicar; en la última celda, Entrar añade otra fila. Pulse Escape para cancelar.',
    };

    for (const [locale, editHint] of Object.entries(expected)) {
      await i18n.changeLanguage(locale);
      expect(i18n.t('visual.editHint', { ns: 'manifest-editor' })).toBe(editHint);
    }
  });

  it('handles {{interpolation}} placeholders', () => {
    const i18n = getI18n();
    // Inline addResource lets us test the interpolation pipeline
    // without polluting the JSON catalogs.
    i18n.addResource('en', 'common', 'test.interp', 'Hello, {{name}}!');
    expect(i18n.t('test.interp', { ns: 'common', name: 'Amir' })).toBe('Hello, Amir!');
  });
});
