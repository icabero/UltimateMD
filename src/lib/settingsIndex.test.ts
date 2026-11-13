import { describe, expect, it } from 'vitest';
import { APP_SETTINGS, NOTE_SETTINGS, VAULT_SETTINGS, findSettings, fold } from './settingsIndex';
import type { Key } from './i18n.svelte';
import { en } from './locales/en';
import { es } from './locales/es';
import { eu } from './locales/eu';

const DICTIONARIES = { es, en, eu };
const scope = { vaults: [{ id: 'a', name: 'Trabajo' }], hasNote: true };
const translate = (lang: keyof typeof DICTIONARIES) => (k: Key, p: Record<string, string | number> = {}) =>
  DICTIONARIES[lang][k].replace(/\{(\w+)\}/g, (m, n) => String(p[n] ?? m));
const names = (lang: keyof typeof DICTIONARIES, query: string, s = scope) => findSettings(query, s, translate(lang)).map((h) => h.entry.id);

describe('settings search', () => {
  it('ignores case and accents', () => {
    expect(fold('ÍDIOMA Ñandú')).toBe('idioma nandu');
    expect(names('es', 'IDIOMA')).toContain('app.language');
    expect(names('es', 'ortografía')).toEqual(names('es', 'ortografia'));
  });

  it('finds by synonyms in any language', () => {
    for (const lang of ['es', 'en', 'eu'] as const) {
      expect(names(lang, 'dark')).toContain('app.theme');
      expect(names(lang, 'oscuro')).toContain('app.theme');
    }
    expect(names('es', 'mcp')).toContain('app.mcp');
    expect(names('es', 'plantilla')).toContain('vault.word.template');
    expect(names('es', 'diagramas')).toContain('note.diagramTheme');
    expect(names('es', 'orden')).toContain('vault.order');
  });

  it('puts the name before the explanation and needs every word', () => {
    expect(names('es', 'idioma')[0]).toBe('app.language');
    expect(names('es', 'idioma zzzz')).toEqual([]);
    expect(names('es', '   ')).toEqual([]);
  });

  it('offers vault and note settings only when they exist', () => {
    expect(names('es', 'plantilla', { vaults: [], hasNote: false })).not.toContain('vault.word.template');
    expect(names('es', 'autor', { vaults: [], hasNote: false })).not.toContain('note.autor');
  });

  it('says where each setting lives', () => {
    const hit = findSettings('plantilla', scope, translate('es'))[0];
    expect(hit.path).toBe('Ajustes de Trabajo › Word');
  });

  it('has unique ids', () => {
    const ids = [...APP_SETTINGS, ...VAULT_SETTINGS, ...NOTE_SETTINGS].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
