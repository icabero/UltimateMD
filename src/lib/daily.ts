// Daily notes: which file holds a day, and how its first lines read.
import { language } from './i18n.svelte';
import { join } from './paths';
import type { DailySettings, DailyFormat } from './api';

export const FORMATS: DailyFormat[] = ['iso', 'yearMonth', 'dayFirst'];

const two = (n: number) => String(n).padStart(2, '0');

/** The day moved by `offset` days (negative is the past). */
export function addDays(date: Date, offset: number) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + offset);
  return next;
}

/** The note's name for a day, without the folder or extension, as `format` writes it. */
export function dailyName(date: Date, format: DailyFormat) {
  const [y, m, d] = [String(date.getFullYear()), two(date.getMonth() + 1), two(date.getDate())];
  if (format === 'dayFirst') return `${d}-${m}-${y}`;
  const iso = `${y}-${m}-${d}`;
  return format === 'yearMonth' ? `${y}/${m}/${iso}` : iso;
}

/** The vault path of the note of a day. */
export const dailyPath = (date: Date, settings: DailySettings) => `${join(settings.folder, dailyName(date, settings.format))}.md`;

/** The date as people write it in the app's language: 13 de noviembre de 2026. */
export const dailyTitle = (date: Date) => date.toLocaleDateString(language(), { day: 'numeric', month: 'long', year: 'numeric' });
