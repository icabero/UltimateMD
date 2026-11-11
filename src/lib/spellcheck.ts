import { language } from './i18n.svelte';
import { frontmatterValue } from './themes';

/** Languages the spelling can be checked in, by their own names. */
export const SPELL_LANGUAGES = [
  { code: 'es', name: 'Castellano', locale: 'es_ES' },
  { code: 'eu', name: 'Euskara', locale: 'eu_ES' },
  { code: 'en', name: 'English', locale: 'en_US' },
  { code: 'ca', name: 'Català', locale: 'ca_ES' },
  { code: 'gl', name: 'Galego', locale: 'gl_ES' },
  { code: 'fr', name: 'Français', locale: 'fr_FR' },
  { code: 'de', name: 'Deutsch', locale: 'de_DE' },
  { code: 'it', name: 'Italiano', locale: 'it_IT' },
  { code: 'pt', name: 'Português', locale: 'pt_PT' },
] as const;

/** Off, the language of the app, or a fixed one. */
export type SpellSetting = 'off' | 'app' | (typeof SPELL_LANGUAGES)[number]['code'];

const KEY = 'ultimatemd.spellcheck';

const known = (code: string | null | undefined) => SPELL_LANGUAGES.find((l) => l.code === code?.toLowerCase().split(/[-_]/)[0]);

export function loadSpellSetting(): SpellSetting {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'off' || saved === 'app' || known(saved) ? (saved as SpellSetting) : 'app';
  } catch {
    return 'app';
  }
}

export function saveSpellSetting(setting: SpellSetting) {
  try {
    localStorage.setItem(KEY, setting);
  } catch {
    // Lasts for this session only.
  }
}

/**
 * The language a note's spelling is checked in, or null when checking is off.
 * A note can name its own with `idioma: en` in its properties.
 */
export function spellLanguage(setting: SpellSetting, note: string): string | null {
  if (setting === 'off') return null;
  const own = known(frontmatterValue(note, 'idioma'));
  if (own) return own.code;
  return setting === 'app' ? language() : setting;
}

/** The dictionary name the system spell checker knows a language by. */
export const dictionaryOf = (code: string) => known(code)?.locale ?? code;
