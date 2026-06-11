# ConfigForge Localization

## Status & roadmap

Phase 0 localization plumbing shipped in v0.3.54; see the [v0.3.54 changelog entry](../../../../CHANGELOG.md#0354---2026-05-28) for what landed. Waves 1-5 (v0.3.55-v0.3.59) have completed English string extraction page-by-page. Machine translation plus review now targets v0.3.60, and QA polish targets v0.3.61.

## Supported locales

| Preference | Meaning |
|------------|---------|
| `en` | English — source language, canonical |
| `fr` | French |
| `de` | German |
| `es` | Spanish |
| `system` | Auto-detect from `navigator.language`; fall back to `en` if unsupported |

Region subtags are stripped before matching: `fr-CA` -> `fr`, `de-AT` -> `de`, `es-MX` -> `es`.

## File layout

```text
apps/desktop/src/locales/
├── index.ts            # i18next bootstrap, NAMESPACES array
├── README.md           # this file
├── en/                 # source-of-truth catalogs
│   ├── common.json
│   ├── sidebar.json
│   ├── settings.json
│   └── ... (13 total)
├── fr/                 # mirrors en/ structure
├── de/
└── es/
```

## How to use translations in a component

`Settings.tsx` `LanguageSection` is the canonical pattern:

```tsx
import { useLocalePreference, type LocalePreference } from '../lib/locale';
import { useTranslation } from 'react-i18next';

function LanguageSection() {
  const [pref, setPref] = useLocalePreference();
  const { t } = useTranslation('settings');
  const choices: { value: LocalePreference; label: string }[] = [
    { value: 'system', label: t('language.options.system') },
    { value: 'en', label: t('language.options.en') },
    { value: 'fr', label: t('language.options.fr') },
    { value: 'de', label: t('language.options.de') },
    { value: 'es', label: t('language.options.es') },
  ];

  return (
    <section aria-label={t('language.sectionTitle')}>
      <h2>{t('language.sectionTitle')}</h2>
      <p>{t('language.sectionDescription')}</p>
      {choices.map((c) => (
        <button key={c.value} onClick={() => setPref(c.value)}>
          {c.label}
        </button>
      ))}
    </section>
  );
}
```

For one namespace, scope the hook and use local keys:

```tsx
const { t } = useTranslation('settings');
return <h2>{t('language.sectionTitle')}</h2>;
```

For multiple namespaces, pass an array and prefix cross-namespace keys:

```tsx
const { t } = useTranslation(['settings', 'common']);
return <button>{t('common:buttons.save')}</button>;
```

Use interpolation for dynamic values:

```json
{
  "foo": {
    "bar": "Hello {{name}}"
  }
}
```

```tsx
t('foo.bar', { name: 'Amir' });
```

Use i18next's default plural forms for counts:

```json
{
  "manifestCount_one": "{{count}} manifest",
  "manifestCount_other": "{{count}} manifests"
}
```

```tsx
t('manifestCount', { count: manifests.length });
```

## How to add a new string

1. Add the key to the appropriate `en/<namespace>.json`. Alphabetize within nesting groups.
2. Reference it from the component with the active namespace, for example `t('language.sectionTitle')`, or with an explicit namespace such as `t('settings:language.sectionTitle')`.
3. Run tests. Do not translate to `fr`, `de`, or `es` by hand — Wave 6's `scripts/translate-locales.mjs` (forthcoming) does that. Until then, missing keys fall back to English automatically.
4. If the string contains brand names (`ConfigForge`, `Azure Local`, `OSConfig`), put the brand inside the value, not as a separate key.

## How to add a new namespace

1. Add the name to the `NAMESPACES` array in `locales/index.ts`.
2. Create `en/<new-namespace>.json` with `{}`. An empty object is fine; Vite's eager glob picks it up at the next build.
3. Optionally create `fr/<new-namespace>.json`, `de/<new-namespace>.json`, and `es/<new-namespace>.json`. Missing language files fall back to `en`.
4. Rebuild. Tests should still pass.

## Carve-outs (DO NOT translate)

Keep these in English:

- Manifest YAML content
- OSConfig CLI output and error messages
- CIS rule titles and rule IDs
- Baseline filenames
- Audit-pack PDF export filenames and headers
- `packages/core` error messages consumed by both desktop UI and headless tooling — must stay greppable
- Telemetry strings
- Monaco editor chrome: find/replace, suggestions, parameter hints
- Brand names: ConfigForge, Azure Local, OSConfig
- Keyboard shortcuts: `Ctrl+S`, `Cmd+Shift+P`, etc.
- Date/number formatting templates. Use the shared `lib/format.ts` hooks (`useDateFormatter`, `useNumberFormatter`, `useRelativeTimeFormatter`) or direct `Intl.*Format` with the active locale instead of translating templates.

Rationale: these are technical artifacts used in bug reports, SI handoffs, customer support, and log searches. Keeping them English preserves grepability and makes support conversations reproducible.

## How the kill-switch works

The localization system has a three-part safety net:

1. `initI18n()` is called from `main.tsx` inside `.catch(...)`. If i18next initialization fails, the app still boots; components render raw keys instead of translations.
2. `useLocalePreference()` and `resolveLocale()` in `lib/locale.ts` wrap all storage and navigator access in `try` / `catch`, returning safe defaults.
3. Emergency reset: run `localStorage.removeItem('configforge-locale')` in DevTools to revert to `system` auto-detect, which falls back to `en` for unsupported locales.

If a release misbehaves because of i18n, revert the offending commit per the plan's revert policy and re-cut a `.patch` release.

## How tests handle i18n

`apps/desktop/vitest.setup.ts` has a fifth `beforeAll` block that resets the locale preference layer and calls `initI18n()`. Tests start in English so existing assertions stay stable.

To test a different language:

```ts
import i18n from '../locales';

beforeEach(async () => {
  await i18n.changeLanguage('fr');
});
```

## Build / dev workflow

| Command | Notes |
|---------|-------|
| `npm run dev --workspace @configforge/desktop` | Hot reload includes locale JSON edits. |
| `npm test` | Run from repo root. The setup initializes i18n in English. |
| `npm run build --workspace @configforge/desktop` | Eager-globs all locale JSON into the bundle. Adds about 30 KB gzipped per language. |

## Roadmap

| Release | Scope | Status |
|---------|-------|--------|
| v0.3.54 | Phase 0: plumbing | ✅ shipped |
| v0.3.55 | Wave 1: shell components | ✅ shipped |
| v0.3.56 | Wave 2: Settings | ✅ shipped |
| v0.3.57 | Wave 3: high-traffic pages | ✅ shipped |
| v0.3.58 | Wave 4: manifest editor | ✅ shipped |
| v0.3.59 | Wave 5: long tail | ✅ shipped |
| v0.3.60 | Machine translation + review | planned |
| v0.3.61 | QA polish (visual, date/number formatting) | planned |
