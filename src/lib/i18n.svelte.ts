import { api } from './api';
import { en } from './locales/en';
import { es } from './locales/es';
import { eu } from './locales/eu';

export type Key = keyof typeof es;

export const LANGUAGES = [
  { code: 'es', name: 'Castellano' },
  { code: 'eu', name: 'Euskara' },
  { code: 'en', name: 'English' },
] as const;

export type Language = (typeof LANGUAGES)[number]['code'];

const LANGUAGE_KEY = 'ultimatemd.language';
const FALLBACK: Language = 'en';
const DICTIONARIES: Record<Language, Record<Key, string>> = { es, eu, en };

const isLanguage = (value: unknown): value is Language => LANGUAGES.some((l) => l.code === value);

function chosen() {
  try {
    const value = localStorage.getItem(LANGUAGE_KEY);
    return isLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

function fromSystem(): Language {
  for (const tag of navigator.languages) {
    const code = tag.split('-')[0].toLowerCase();
    if (isLanguage(code)) return code;
  }
  return FALLBACK;
}

let current = $state<Language>(chosen() ?? fromSystem());
document.documentElement.lang = current;

function show(next: Language) {
  current = next;
  document.documentElement.lang = next;
}

export const language = () => current;

export function setLanguage(next: Language) {
  show(next);
  try {
    localStorage.setItem(LANGUAGE_KEY, next);
  } catch {
    // The choice lasts for this session only.
  }
}

/** The language picked in the installer applies until the user chooses another. */
export async function applyInstallerLanguage() {
  if (chosen()) return;
  const installed = await api.installerLanguage().catch(() => null);
  if (isLanguage(installed)) show(installed);
}

/** Reads the current language, so it updates wherever it is used in a template. */
export function tr(key: Key, params: Record<string, string | number> = {}) {
  return DICTIONARIES[current][key].replace(/\{(\w+)\}/g, (match, name) => String(params[name] ?? match));
}

export const themeName = (theme: { id: string }) => tr(`theme.${theme.id}` as Key);
