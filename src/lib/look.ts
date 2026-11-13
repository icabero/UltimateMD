// How files, folders and notes are told apart in the tree, the tabs and the path bar.
import { extOf, kindOf } from './paths';

/** The icon of a file by what it is: a note, a web page, an image, a PDF or anything else. */
export function iconOf(path: string) {
  const kind = kindOf(path);
  if (kind === 'md') return 'note';
  if (kind === 'html') return 'code';
  if (kind === 'image') return 'image';
  return extOf(path) === 'pdf' ? 'pdf' : 'file';
}

/**
 * The colours a folder can have, by the name stored in the vault. Each is a colour of
 * the theme, so it reads well in light and dark and follows a theme of the vault.
 */
export const FOLDER_COLORS: Record<string, string> = {
  accent: 'var(--accent)',
  danger: 'var(--danger)',
  string: 'var(--syn-string)',
  attr: 'var(--syn-attr)',
  keyword: 'var(--syn-keyword)',
  number: 'var(--syn-number)',
  muted: 'var(--text-3)',
};

/** A short list to choose from; anything else can be typed. */
export const EMOJIS = [
  '📁', '📂', '📚', '📝', '📌', '⭐', '💡', '🧭', '🎯', '🔬', '💼', '🏠',
  '✅', '🔥', '🌱', '🎨', '🎵', '💬', '🔒', '📅', '✈️', '🧪', '⚙️', '❤️',
];

/** What can be one icon: a few characters, not a sentence. */
export const validEmoji = (value: string) => value.trim().length > 0 && [...value.trim()].length <= 16 && !/[\p{Cc}\s]/u.test(value.trim());
