// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeLocales, renderReport } from './review-locales.mjs';

const workspace = path.join(process.cwd(), 'scripts', '.test-workspaces', 'review');

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

describe('review-locales', () => {
  it('detects placeholder violations', async () => {
    await rm(workspace, { recursive: true, force: true });
    await writeJson(path.join(workspace, 'en', 'common.json'), { greeting: 'Hello {{name}}' });
    await writeJson(path.join(workspace, 'fr', 'common.json'), { greeting: 'Bonjour {{nom}}' });
    await writeJson(path.join(workspace, 'de', 'common.json'), { greeting: 'Hallo {{name}}' });
    await writeJson(path.join(workspace, 'es', 'common.json'), { greeting: 'Hola {{name}}' });
    const analysis = await analyzeLocales({ root: workspace });
    expect(analysis.placeholderIssues).toEqual([
      { locale: 'fr', namespace: 'common', key: 'greeting', en: ['name'], target: ['nom'] },
    ]);
    await rm(workspace, { recursive: true, force: true });
  });

  it('generates length warnings in the markdown report', async () => {
    await rm(workspace, { recursive: true, force: true });
    await writeJson(path.join(workspace, 'en', 'common.json'), { message: 'This is a moderately long message.' });
    await writeJson(path.join(workspace, 'fr', 'common.json'), {
      message: 'Ceci est un message localisé beaucoup plus long qui devrait être signalé par le rapport.',
    });
    await writeJson(path.join(workspace, 'de', 'common.json'), { message: 'Dies ist eine Meldung.' });
    await writeJson(path.join(workspace, 'es', 'common.json'), { message: 'Este es un mensaje.' });
    const analysis = await analyzeLocales({ root: workspace });
    const report = renderReport(analysis);
    expect(analysis.lengthWarnings.length).toBe(1);
    expect(report).toContain('Layout warnings (>150% of English): **1**');
    await rm(workspace, { recursive: true, force: true });
  });
});
